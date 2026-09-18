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
- `unresolved`: evidence is insufficient or malformed; fail closed and do not auto-merge.

An `equivalent` result always projects to:

`business:<CURRENT TARGET BUSINESS ID>`

A foreign or cross-org business ID is never used as the projected target key.

## Automatic-equivalence evidence

Only these paths may auto-project to the current target:

1. Exact current target business ID.
2. Exact canonical Naver Place ID.
3. Exact verified **concrete** official URL **plus** an exact, pre-verified opaque branch/business identity key.
4. Exact normalized full address **plus** exact verified phone.

No name or alias surface is standalone Target Equivalence evidence. Exact current names/aliases should normally have been resolved upstream as registered-business identity; this layer does not re-decide that from strings.

## Strong conflicts and malformed identity

- If both sides contain valid canonical Naver Place IDs and they differ, the result is `distinct`.
- If a non-empty canonical Naver Place field is malformed or uses an unsupported host/shape, the result is `unresolved` before weaker evidence may merge it.
- A foreign/cross-org business ID alone is neither equivalent nor distinct.

## Naver Place rule

A canonical numeric ID is accepted directly.

If a URL is supplied, only these hosts are accepted:

- `place.naver.com`
- `m.place.naver.com`
- `map.naver.com`

Supported Naver Place page shapes include dedicated Place-host category pages such as `/restaurant/<id>/...` and map entry/place paths. A non-Naver URL containing `/place/<id>` is never accepted as Naver Place evidence.

## URL rule

Only verified concrete official URLs are identity evidence.

- A root page is rejected even if it has non-tracking query parameters such as `?lang=ko`.
- Non-default ports are part of the origin and must be preserved.
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
- same building, same brand, same root domain, near-identical names, generic aliases, or query-only root URLs must not overmerge
- a different valid Naver Place ID must defeat weaker same-name evidence
- malformed/unsupported Place evidence fails closed
- different URL ports remain different origins
- punctuation-distinct opaque branch keys remain distinct
- non-confirmed entities fail closed
- the engine is deterministic and input-immutable
