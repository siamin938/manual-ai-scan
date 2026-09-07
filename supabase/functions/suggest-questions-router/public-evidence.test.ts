import { describe, expect, it } from "vitest";

import { resolveEvidenceGenerationBasis } from "./public-evidence.ts";

const TAXONOMY = ["ppf", "wrapping", "car_wash"];

const service = (over: Record<string, unknown> = {}) => ({
  key: "ppf",
  label: "PPF",
  evidenceStatus: "registration_only",
  targetRegistrationMatch: true,
  registrationHits: 1,
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  inputSensitivityDetected: false,
  coreServices: [service()],
  candidateServices: [],
  adjacentServices: [],
  ...over,
});

describe("resolveEvidenceGenerationBasis", () => {
  it("A) public evidence wins", () => {
    const r = resolveEvidenceGenerationBasis(profile(), TAXONOMY, true);
    expect(r).toEqual({
      ready: true,
      publicEvidenceReady: true,
      registrationBacked: false,
      generationBasis: "public_evidence",
    });
  });

  it("B) registration_only with safe conditions", () => {
    const r = resolveEvidenceGenerationBasis(profile(), TAXONOMY, false);
    expect(r).toEqual({
      ready: false,
      publicEvidenceReady: false,
      registrationBacked: true,
      generationBasis: "registration_backed",
    });
  });

  it("C) verification_pending with safe conditions", () => {
    const r = resolveEvidenceGenerationBasis(
      profile({ coreServices: [service({ evidenceStatus: "verification_pending" })] }),
      TAXONOMY,
      false,
    );
    expect(r.generationBasis).toBe("registration_backed");
    expect(r.registrationBacked).toBe(true);
    expect(r.ready).toBe(false);
    expect(r.publicEvidenceReady).toBe(false);
  });

  it("D) input sensitivity blocks fallback", () => {
    const r = resolveEvidenceGenerationBasis(profile({ inputSensitivityDetected: true }), TAXONOMY, false);
    expect(r).toEqual({
      ready: false,
      publicEvidenceReady: false,
      registrationBacked: false,
      generationBasis: null,
    });
  });

  it("E) targetRegistrationMatch=false blocks fallback", () => {
    const r = resolveEvidenceGenerationBasis(
      profile({ coreServices: [service({ targetRegistrationMatch: false })] }),
      TAXONOMY,
      false,
    );
    expect(r.generationBasis).toBeNull();
    expect(r.registrationBacked).toBe(false);
    expect(r.ready).toBe(false);
  });

  it("F) registrationHits=0 blocks fallback", () => {
    const r = resolveEvidenceGenerationBasis(
      profile({ coreServices: [service({ registrationHits: 0 })] }),
      TAXONOMY,
      false,
    );
    expect(r.generationBasis).toBeNull();
    expect(r.registrationBacked).toBe(false);
  });

  it("G) service outside active taxonomy blocks fallback", () => {
    const r = resolveEvidenceGenerationBasis(
      profile({ coreServices: [service({ key: "not_in_taxonomy" })] }),
      TAXONOMY,
      false,
    );
    expect(r.generationBasis).toBeNull();
    expect(r.registrationBacked).toBe(false);
    expect(r.publicEvidenceReady).toBe(false);
  });

  it("empty taxonomy list is fail-closed", () => {
    const r = resolveEvidenceGenerationBasis(profile(), [], false);
    expect(r.generationBasis).toBeNull();
  });
});
