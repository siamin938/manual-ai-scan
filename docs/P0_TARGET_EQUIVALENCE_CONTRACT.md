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
- `unresolved`: evidence is insufficient; fail closed and do not auto-merge.

An `equivalent` result always projects to:

`business:<CURRENT TARGET BUSINESS ID>`

A foreign or cross-org business ID is never used as the projected target key.

## Evidence precedence

Automatic equivalence is allowed only by these paths:

1. Exact current target business ID.
2. Exact canonical Naver Place ID.
3. Exact verified **concrete** official URL plus a pre-verified compatible branch/business identity key.
4. Exact surface match against a name/alias explicitly owned by the current target.
5. Exact normalized full address plus an additional strong corroborator, currently verified phone; future callers may add other corroborators only through this versioned contract.

A conflicting canonical Naver Place ID is a strong negative and returns `distinct` before weaker evidence can merge the entity.

## Evidence that is never sufficient by itself

The engine must not auto-merge from:

- fuzzy or near name similarity
- brand core equality
- same city/gu plus brand
- same full address alone
- same root/corporate domain alone
- repeated occurrence frequency
- cross-org row existence
- fuzzy branch-name similarity

## URL rule

Only verified concrete URLs are identity evidence. Root domains such as `https://example.com/` are rejected as concrete branch identity. Tracking parameters do not create a new identity.

## Address rule

Address normalization is formatting-only. Exact normalized full address by itself is not sufficient because multiple businesses may share a building/address. A second strong corroborator is mandatory.

## Branch identity rule

The pure engine does **not** derive `branchIdentityKey` from fuzzy names. It accepts only a pre-verified upstream key and compares it exactly. How that key is produced remains a Phase 2B contract question.

## Parser rule

`measurements.was_client_mentioned` and `client_position` are raw parser audit signals. They are not inputs to Target Equivalence and do not force `equivalent`.

## Required regression properties

- same physical business may project to the current target even if the observed registered row belongs to another org
- the foreign business ID must never escape as the target projection
- same building, same brand, same root domain, or near-identical names must not overmerge
- non-confirmed entities fail closed
- the engine is deterministic and input-immutable
