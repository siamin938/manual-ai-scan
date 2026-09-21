# Preview UX copy sync

## Scope
- Treat GitHub commit `50c06c5fa9d6a916263d0320923581167e6b7e44` as the source of truth.
- Sync only `src/routes/_authenticated/dashboard.tsx`; leave every other source file unchanged.
- Do not touch Supabase, production publishing, or deployment.

## Steps
1. Compare the current dashboard file byte-for-byte with the target commit and replace it only if different.
2. Confirm all three requested new phrases are present and `내 업체에서는 미관찰` is absent.
3. Run the TypeScript check, Entity Engine v2 tests, and production build to rebuild Preview.
4. Confirm the latest Preview build result and verify no unrelated source-file changes were introduced.

## Current finding
The current checkout is already at the requested commit, and the dashboard contains all requested new copy. The validation commands will still be run to confirm the final state.
