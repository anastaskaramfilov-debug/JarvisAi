"""Sync between the PC Jarvis and the phone Jarvis, through a private GitHub repo, end-to-end encrypted.

Files in the private repo (all encrypted with AES-256-GCM; the key comes from your passphrase via PBKDF2,
so GitHub, or anyone who gets the repo, only sees random bytes):
  state.enc    your profile, tasks, skills, recent conversation and the phone's settings (incl. the Gemini key)
  mailbox.enc  requests the phone leaves for the PC ("open Spotify on the PC") and the PC's answers

The phone and the PC each keep the last state they agreed on, so a three-way merge keeps edits and deletions
from both sides. The PC never has to be reachable from the internet: it fetches the mailbox every few seconds.
"""
import base64
import hashlib
import json
import os
import threading
import time
import uuid

import requests

CTX = {}                         # log, data_dir, get/set callbacks, chat, config, save_config
ITER = 600_000
_keys = {}                       # (passphrase hash, salt) -> key bytes
_lock = threading.RLock()
STATUS = {"state": "off", "last": None, "error": None, "pending_pushes": 0}
_etag = {}
_seen_requests = set()


def log(m):
    (CTX.get("log") or print)(m)


def cfg():
    return CTX["config"]()


def enabled():
    c = cfg()
    return bool(c.get("sync_repo") and c.get("sync_token") and c.get("sync_passphrase"))


# ---------------------------------------------------------------- crypto
def _key(passphrase: str, salt: bytes, iters: int = None) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    iters = iters or ITER
    k = (hashlib.sha256(passphrase.encode()).hexdigest(), salt, iters)
    if k not in _keys:
        _keys[k] = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iters).derive(
            passphrase.encode("utf-8"))
    return _keys[k]


def encrypt(obj, name: str, passphrase: str, salt: bytes = None) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt = salt or os.urandom(16)
    iv = os.urandom(12)
    ct = AESGCM(_key(passphrase, salt)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                                               f"jarvis-sync-v1:{name}".encode())
    b = lambda x: base64.b64encode(x).decode()
    return json.dumps({"v": 1, "kdf": "pbkdf2-sha256", "iter": ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)})


def decrypt(text: str, name: str, passphrase: str):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    env = json.loads(text)
    if env.get("v") != 1 or env.get("kdf") != "pbkdf2-sha256" or not 100_000 <= int(env.get("iter", 0)) <= 5_000_000:
        raise ValueError("unknown sync format")
    salt, iv, ct = (base64.b64decode(env[k]) for k in ("salt", "iv", "ct"))
    try:
        data = AESGCM(_key(passphrase, salt, int(env["iter"]))).decrypt(iv, ct, f"jarvis-sync-v1:{name}".encode())
    except InvalidTag:
        raise PermissionError("wrong passphrase (or the file was tampered with)")
    return json.loads(data), salt


# ---------------------------------------------------------------- GitHub storage
def _gh(method, path, **kw):
    c = cfg()
    url = f"https://api.github.com/repos/{c['sync_repo']}/contents/{path}"
    h = {"Authorization": f"Bearer {c['sync_token']}", "Accept": "application/vnd.github+json",
         "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Jarvis"}
    h.update(kw.pop("headers", {}))
    return requests.request(method, url, headers=h, timeout=20, **kw)


def read_file(name, use_etag=False):
    """(object or None, sha, salt, changed). Raises on auth/crypto errors."""
    hdr = {"If-None-Match": _etag[name]} if use_etag and name in _etag else {}
    r = _gh("GET", name, headers=hdr)
    if r.status_code == 304:
        return None, None, None, False
    if r.status_code == 404:
        return None, None, None, True
    if r.status_code in (401, 403):
        raise PermissionError("GitHub refused the sync key. Check the token in Settings > Phone.")
    r.raise_for_status()
    if r.headers.get("ETag"):
        _etag[name] = r.headers["ETag"]
    j = r.json()
    raw = base64.b64decode(j["content"]).decode("utf-8")
    obj, salt = decrypt(raw, name, cfg()["sync_passphrase"])
    return obj, j["sha"], salt, True


def write_file(name, obj, sha, salt=None):
    body = {"message": f"Jarvis sync: {name}", "content": base64.b64encode(
        encrypt(obj, name, cfg()["sync_passphrase"], salt).encode()).decode()}
    if sha:
        body["sha"] = sha
    r = _gh("PUT", name, json=body)
    if r.status_code in (409, 422):
        raise ConflictError()
    if r.status_code in (401, 403):
        raise PermissionError("GitHub refused to save. The token needs 'Contents: Read and write' on the sync repo.")
    r.raise_for_status()
    _etag.pop(name, None)
    return r.json()["content"]["sha"]


class ConflictError(Exception):
    pass


# ---------------------------------------------------------------- three-way merge
def merge_by_key(base, local, remote, key):
    """Keeps additions and deletions from both sides; when both changed an item, the local one wins."""
    B = {key(x): x for x in base or []}
    L = {key(x): x for x in local or []}
    R = {key(x): x for x in remote or []}
    out = []
    for k in list(dict.fromkeys(list(L) + list(R))):
        inL, inR, inB = k in L, k in R, k in B
        if inL and inR:
            out.append(R[k] if (inB and L[k] == B[k]) else L[k])
        elif inL:
            if not inB or L[k] != B[k]:          # new here, or changed here after the other side deleted it
                out.append(L[k])
        elif inR:
            if not inB or R[k] != B[k]:
                out.append(R[k])
    return out


def _hist_key(m):
    return hashlib.sha1(f"{m.get('role')}|{m.get('text')}|{m.get('t')}|{m.get('d', '')}".encode()).hexdigest()


def merge_state(base, local, remote):
    base, remote = base or {}, remote or {}
    out = {"v": 1, "updated": time.time()}
    out["facts"] = merge_by_key(base.get("facts"), local.get("facts"), remote.get("facts"), lambda f: f["id"])
    out["tasks"] = merge_by_key(base.get("tasks"), local.get("tasks"), remote.get("tasks"), lambda t: t["id"])
    out["skills"] = merge_by_key(base.get("skills"), local.get("skills"), remote.get("skills"),
                                 lambda s: s["name"].lower())
    hist = {_hist_key(m): m for m in (remote.get("history") or []) + (local.get("history") or [])}
    out["history"] = sorted(hist.values(), key=lambda m: m.get("ts", 0))[-200:]
    out["settings"] = local.get("settings") or remote.get("settings") or {}     # the PC owns the settings
    return out


# ---------------------------------------------------------------- the sync loop
def _base_file():
    return CTX["data_dir"] / "sync_base.json"


def _load_base():
    try:
        return json.loads(_base_file().read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_base(state):
    _base_file().write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")


def sync_now(reason=""):
    """Pull, merge, apply locally, push. Safe to call any time."""
    if not enabled():
        STATUS.update(state="off")
        return STATUS
    with _lock:
        try:
            for attempt in range(4):
                remote, sha, salt, _ = read_file("state.enc")
                if salt:
                    _snap["salt"] = salt                   # the phone's key is made with this salt
                base = _load_base()
                local = CTX["get_local"]()
                merged = merge_state(base, local, remote)
                CTX["apply"](merged)                       # profile, tasks, skills, history on the PC
                if remote is None or _strip(merged) != _strip(remote):
                    try:
                        write_file("state.enc", merged, sha, salt)
                    except ConflictError:
                        time.sleep(0.6)
                        continue
                    if not salt:
                        _snap["salt"] = None               # first copy just made: learn its salt next round
                _save_base(merged)
                break
            STATUS.update(state="ok", last=time.time(), error=None)
        except Exception as e:
            STATUS.update(state="error", error=str(e)[:200])
            log(f"Sync: {e}")
    return STATUS


def _strip(s):
    return {k: v for k, v in (s or {}).items() if k != "updated"}


_dirty = threading.Event()


def changed():
    """Call after anything synced changes on the PC; the push happens a few seconds later."""
    _dirty.set()


def sync_loop():
    last_full = 0
    while True:
        try:
            if enabled():
                if _dirty.is_set() or time.time() - last_full > 120:
                    time.sleep(3)                          # gather several quick changes into one push
                    _dirty.clear()
                    sync_now()
                    last_full = time.time()
                check_mailbox()
                push_snapshot()
        except Exception as e:
            log(f"Sync loop: {e}")
        time.sleep(6)


# ---------------------------------------------------------------- what the phone shows on its Markets and Inbox pages
_snap = {"t": 0, "sig": None, "sha": None, "known": False, "salt": None}


def push_snapshot(force=False):
    """Every 10 minutes: the watchlist quotes and the newest unread emails, encrypted like everything else.
    Written only when something changed, so a quiet PC makes no commits."""
    if "snapshot" not in CTX or (not force and time.time() - _snap["t"] < 600):
        return
    try:
        if not _snap["salt"]:                              # must be the same salt as state.enc, or the phone can't open it
            _snap["salt"] = read_file("state.enc")[2]
        if not _snap["salt"]:
            return
        _snap["t"] = time.time()
        body = CTX["snapshot"]()
        sig = hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if sig == _snap["sig"]:
            return
        for attempt in range(3):
            if not _snap["known"]:
                _, _snap["sha"], _, _ = read_file("snapshot.enc")
                _snap["known"] = True
            try:
                _snap["sha"] = write_file("snapshot.enc", dict(body, t=time.time()), _snap["sha"], _snap["salt"])
                _snap["sig"] = sig
                return
            except ConflictError:
                _snap["known"] = False
    except Exception as e:
        log(f"Sync snapshot: {e}")


# ---------------------------------------------------------------- the phone's requests to the PC
def check_mailbox():
    """Answers requests the phone left for the PC. Old requests (PC was off) are not run later."""
    try:
        box, sha, salt, changed_ = read_file("mailbox.enc", use_etag=True)
    except PermissionError as e:
        STATUS.update(state="error", error=str(e))
        return
    if not changed_ or not box:
        return
    now = time.time()
    todo = [r for r in box.get("requests", []) if r.get("id") not in _seen_requests
            and r["id"] not in {a.get("id") for a in box.get("answers", [])}]
    for req in todo:
        _seen_requests.add(req["id"])
        if now > float(req.get("expires", 0)) or now - float(req.get("t", 0)) > 600:
            continue
        log(f"Phone asked the PC: {req.get('text', '')[:80]}")
        try:
            r = CTX["chat"]("[From the phone app] " + str(req.get("text", ""))[:2000])
            reply = r.get("reply") or "Done."
            if r.get("confirm"):
                reply += " It's waiting for you to click Allow on the PC."
        except Exception as e:
            reply = f"The PC couldn't do it: {e}"
        _answer(req["id"], reply)


def _answer(rid, reply):
    for attempt in range(4):
        box, sha, salt, _ = read_file("mailbox.enc")
        box = box or {"requests": [], "answers": []}
        box["answers"] = (box.get("answers", []) + [{"id": rid, "reply": reply, "t": time.time()}])[-30:]
        box["requests"] = box.get("requests", [])[-30:]
        try:
            write_file("mailbox.enc", box, sha, salt)
            return
        except ConflictError:
            time.sleep(0.5)


# ---------------------------------------------------------------- setup
def setup(repo: str, token: str, passphrase: str) -> dict:
    """Checks the repo and key, then makes the first encrypted copy."""
    repo = repo.strip().strip("/")
    if repo.startswith("https://github.com/"):
        repo = repo[len("https://github.com/"):]
    if repo.count("/") != 1:
        raise ValueError("Write the repo as yourname/jarvis-sync")
    if len(passphrase) < 10:
        raise ValueError("Use a passphrase of at least 10 characters (a short sentence is ideal)")
    r = requests.get(f"https://api.github.com/repos/{repo}", timeout=15,
                     headers={"Authorization": f"Bearer {token.strip()}", "User-Agent": "Jarvis"})
    if r.status_code == 404:
        raise ValueError("Can't see that repo with this token. Check the name and that the token includes it.")
    if r.status_code in (401, 403):
        raise ValueError("GitHub didn't accept the token.")
    j = r.json()
    if not j.get("private"):
        raise ValueError("The sync repo must be Private (it's encrypted anyway, but private is safer).")
    if not (j.get("permissions") or {}).get("push"):
        raise ValueError("The token can read but not write. Give it 'Contents: Read and write'.")
    c = cfg()
    c.update(sync_repo=repo, sync_token=token.strip(), sync_passphrase=passphrase)
    CTX["save_config"]()
    try:                                                    # existing copy: the passphrase must match it
        read_file("state.enc")
    except PermissionError:
        c.update(sync_repo="", sync_token="", sync_passphrase="")
        CTX["save_config"]()
        raise ValueError("That repo already has Jarvis data with a different passphrase.")
    except Exception:
        pass
    st = sync_now("setup")
    if st.get("state") == "error":
        raise ValueError(st.get("error") or "First sync failed")
    return {"ok": True, "repo": repo}


def turn_off():
    c = cfg()
    c.update(sync_repo="", sync_token="", sync_passphrase="")
    CTX["save_config"]()
    _base_file().unlink(missing_ok=True)
    STATUS.update(state="off", error=None)


def start(**kw):
    CTX.update(kw)
    threading.Thread(target=sync_loop, daemon=True).start()
