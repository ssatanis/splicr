"""
Who is calling, and what may they read.

THIS SERVICE IS NOT PUBLIC

The engine connects to Postgres with the secret key and therefore bypasses Row
Level Security (see splicr/db.py). That is deliberate - a pipeline has to write
rows for an organization it is not a member of - and it is exactly why nothing a
browser can reach may call this service directly. The console reads recorded rows
through Supabase under the reader's own session, where RLS applies; this API is
for service callers: Modal jobs and an organization's own scripted access.

Because RLS does not protect these routes, authorization is explicit on every
one of them. A caller presents a SplicR Connect key as a bearer token. Only the
sha-256 hex digest of the whole key is stored, so the presented key is hashed
here and the digest is what is looked up; the key itself is never compared,
stored or logged. The lookup and every organization check go through the
security definer functions in supabase/migrations/20260927000500_connect_api.sql,
which derive the organization from the digest, so a caller cannot name a
workspace or a screen it does not hold the key for.

Ownership is `screens.org_id = api_keys.org_id`, not `can_read_screen()`: a key
must not reach another workspace's screen just because that screen was published.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

#: The only scope any endpoint checks today. The rest of public.api_keys.scopes
#: is reserved and the console labels it so; adding a check here without adding
#: the endpoint it guards would be worse than honest silence.
HITS_READ = "hits:read"

#: Prefix every SplicR Connect key carries. Checked before hashing so an
#: obviously wrong token is refused without a database round trip.
KEY_PREFIXES = ("spk_live_", "spk_test_")


@dataclass(frozen=True)
class Caller:
    """An authenticated service caller, and the organization its key belongs to."""

    key_id: str
    key_name: str
    org_id: str
    org_slug: str
    scopes: tuple[str, ...]
    #: The digest, kept so the screen check can go through the same function the
    #: web route uses. Never logged and never returned in a response.
    _key_hash: str

    def has(self, scope: str) -> bool:
        return scope in self.scopes

    def may_read_screen(self, conn, screen_id: str) -> bool:
        """
        Whether this key's organization owns the screen.

        Goes through public.api_key_screen so the rule lives in one place and
        cannot drift from the web route's. An empty result means "not yours or
        not there", and the caller answers 404 for both.
        """
        row = conn.execute(
            "select screen_id from public.api_key_screen(%s, %s)",
            (self._key_hash, screen_id),
        ).fetchone()
        return row is not None


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401,
            detail="present a SplicR Connect key as 'Authorization: Bearer <key>'",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token.strip()


def authenticate(request: Request) -> Caller:
    """Resolve the bearer key to a caller, or refuse with 401."""
    from .. import db

    token = _bearer(request)
    if not token.startswith(KEY_PREFIXES):
        raise HTTPException(status_code=401, detail="unknown key",
                            headers={"WWW-Authenticate": "Bearer"})
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with db.connect() as conn:
        row = conn.execute(
            "select key_id, key_name, org_id, org_slug, scopes, revoked, expired "
            "from public.api_key_resolve(%s)",
            (digest,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="unknown key",
                                headers={"WWW-Authenticate": "Bearer"})
        key_id, key_name, org_id, org_slug, scopes, revoked, expired = row
        if revoked:
            raise HTTPException(status_code=401, detail="this key was revoked",
                                headers={"WWW-Authenticate": "Bearer"})
        if expired:
            raise HTTPException(status_code=401, detail="this key has expired",
                                headers={"WWW-Authenticate": "Bearer"})
        conn.execute("select public.api_key_touch(%s)", (digest,))
    return Caller(
        key_id=str(key_id), key_name=str(key_name), org_id=str(org_id),
        org_slug=str(org_slug), scopes=tuple(scopes or ()), _key_hash=digest,
    )


def require_hits_read(caller: Caller = Depends(authenticate)) -> Caller:
    """A caller whose key carries hits:read, or 403."""
    if not caller.has(HITS_READ):
        raise HTTPException(
            status_code=403,
            detail=f"this key does not carry the {HITS_READ} scope")
    return caller
