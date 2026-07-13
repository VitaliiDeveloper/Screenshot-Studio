# Phase 9 Slice 1 implementation plan — store output families

1. Widen `SCREEN_DEVICES_BY_PLATFORM`, the discriminated `Screen` union, lead-target mapping, and
   `store-specs.json` together.
2. Add one pure core operation that clones the active locale's complete root set into a missing
   output family with fresh ids and lead-artboard fitting.
3. Expose that operation through the editor store and show every supported family in Store Outputs;
   open existing outputs and create missing outputs without local component state.
4. Make exact lead dimensions the root/master default, keep them read-only in the Inspector, and
   route explicit customize/reset actions through one atomic composition-fitting core operation.
5. Derive export-dialog filters from the project instead of hardcoded platform/device options.
6. Add focused schema, core, editor-store, editor workspace, and export tests. Run only exact E2E
   files required by changed browser behavior; leave the full browser suite to `dev` → `main` CI.
