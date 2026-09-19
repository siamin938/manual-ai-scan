# P0 Target Equivalence Contract — Phase 2A

Status: pure-engine contract only. No Production DB, migration, Edge, UI, consumer cutover, or new measurement is part of this phase.

## Separation of responsibility

Entity Engine v2 keeps two semantic questions separate:

1. **Business Identity Gate** — Is the candidate a real, specific business?
2. **Target Equivalence** — Is that confirmed business the same physical business as the current measurement target?

Target Equivalence only evaluates candidates already classified as `confirmed_business`.

## Decisions

- `equivalent`: strong identity evidence proves the observed business is the current target.
- `distinct`: strong contradictory identity evidence proves it is not the current target.
- `unresolved`: evidence is insufficient, malformed, or unsupported; fail closed and do not auto-merge.

An `equivalent` result always projects to:

`business:<CURRENT TARGET BUSINESS ID>`

A foreign or cross-org business ID is never used as the projected target key.

## Evidence precedence

Before trusting an internal row ID, the engine validates stronger public Place identity evidence:

1. Unsupported/malformed non-empty Naver Place evidence → `unresolved`
2. Two valid canonical Naver Place IDs that conflict → `distinct`
3. Then exact current target business ID may return `equivalent`
4. Exact canonical Naver Place ID → `equivalent`
5. Exact verified **concrete** official URL + exact opaque branch/business identity key → `equivalent`
6. Exact normalized full address + exact verified phone → `equivalent`
7. Otherwise → `unresolved`

This order is intentional: a stale or incorrectly attached internal business ID must not override stronger contradictory public identity evidence.

## Naver Place rule

A canonical numeric ID is accepted directly.

If a URL is supplied, only these hosts are accepted:

- `place.naver.com`
- `m.place.naver.com`
- `map.naver.com`

Supported URL shapes are intentionally narrow and versioned.

For `place.naver.com` and `m.place.naver.com`, the first path segment must be one of:

- `place`
- `restaurant`
- `cafe`
- `hairshop`
- `hospital`
- `accommodation`
- `attraction`

followed by the numeric Place ID.

For `map.naver.com`, supported paths are:

- `/p/entry/place/<id>`
- `/entry/place/<id>`
- `/place/<id>`

Query-only shapes such as `/?placeId=<id>` are not accepted in Phase 2A. Unsupported categories such as `/anything/<id>` fail closed.

A non-Naver URL containing `/place/<id>` is never accepted as Naver Place evidence.

## URL rule

Only verified concrete official URLs are identity evidence.

- The URL scheme is part of identity. `http://...` and `https://...` are different origins.
- Non-default ports are part of identity and are preserved.
- A root page is rejected even if it has non-tracking query parameters such as `?lang=ko`.
- Tracking parameters do not create a new identity.
- Same corporate/root domain alone is never sufficient.
- A shared concrete URL still requires an exact pre-verified branch/business identity key.

## Address rule

Address normalization is formatting-only. Exact normalized full address by itself is not sufficient because multiple businesses may share a building/address.

Phase 2A permits address equivalence only when the verified phone also matches exactly.

## Alias rule

Target-owned aliases are not standalone Target Equivalence evidence. This prevents generic or non-unique aliases such as `공식점`, `본점`, or a shared brand surface from merging another branch into the current target.

Alias ownership and registered-name matching remain upstream Business Identity responsibilities.

## Branch identity rule

`branchIdentityKey` is an opaque upstream-verified key.

The Target Equivalence engine:

- does not derive it from fuzzy names
- does not remove punctuation
- does not lowercase or otherwise destructively normalize it
- compares the trimmed key exactly

How the upstream layer creates and verifies this opaque key remains a Phase 2B contract question.

## Evidence that is never sufficient by itself

The engine must not auto-merge from:

- fuzzy or near name similarity
- brand core equality
- same city/gu plus brand
- same full address alone
- same root/corporate domain alone
- root URL plus arbitrary query parameters
- repeated occurrence frequency
- cross-org row existence
- fuzzy branch-name similarity
- target-owned alias alone

## Parser rule

`measurements.was_client_mentioned` and `client_position` are raw parser audit signals. They are not inputs to Target Equivalence and do not force `equivalent`.

## Required regression properties

- same physical business may project to the current target even if the observed registered row belongs to another org, but only with strong public identity evidence
- the foreign business ID must never escape as the target projection
- same building, same brand, same root domain, near-identical names, generic aliases, query-only root URLs, or unsupported Naver URL shapes must not overmerge
- a different valid Naver Place ID must override an internal current-business-id match and return `distinct`
- malformed/unsupported Place evidence must override an internal current-business-id match and fail closed
- `http` and `https` concrete URLs remain different origins
- different URL ports remain different origins
- punctuation-distinct opaque branch keys remain distinct
- non-confirmed entities fail closed
- the engine is deterministic and input-immutable
