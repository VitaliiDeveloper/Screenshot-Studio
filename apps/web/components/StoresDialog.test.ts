// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mockEditorState = vi.hoisted(() => ({
  project: {
    meta: { name: "App", schemaVersion: 1 },
    layouts: [],
    publishing: { google: { packageName: "com.example.app" } },
  } as unknown,
}));

vi.mock("zustand", () => ({
  useStore: (_store: unknown, selector: (state: typeof mockEditorState) => unknown) => selector(mockEditorState),
}));

import { CredentialStatusLine, storeIdentifierError, StoresDialog } from "./StoresDialog.js";

describe("StoresDialog", () => {
  it("validates identifiers with the project schema and lets an empty value clear them", () => {
    expect(storeIdentifierError("google", "com.example.app")).toBeNull();
    expect(storeIdentifierError("google", "")).toBeNull();
    expect(storeIdentifierError("google", "not a package")).toBe("Google Play package name must look like com.example.app");
    expect(storeIdentifierError("apple", "1234567890")).toBeNull();
    expect(storeIdentifierError("apple", "abc")).toBe("Apple app id must be the numeric App Store Connect Apple ID");
  });

  it("shows key status without any key value", () => {
    expect(renderToStaticMarkup(React.createElement(CredentialStatusLine, { status: undefined }))).toContain("Checking key");
    expect(renderToStaticMarkup(React.createElement(CredentialStatusLine, {
      status: { configured: false, updatedAt: null },
    }))).toContain("No key configured");
    expect(renderToStaticMarkup(React.createElement(CredentialStatusLine, {
      status: { configured: true, updatedAt: "2026-10-31T12:00:00.000Z" },
    }))).toContain("Key configured · updated");
  });

  it("lists every known store with its identifier, a key picker, and the not-yet-available note for Apple", () => {
    const markup = renderToStaticMarkup(React.createElement(StoresDialog, { onClose: () => undefined }));
    expect(markup).toContain("Google Play");
    expect(markup).toContain("App Store Connect");
    expect(markup).toContain('value="com.example.app"');
    expect(markup).toContain('aria-label="Google Play service account key"');
    expect(markup).toContain('accept=".p8"');
    expect(markup).toContain("Uploading to App Store Connect from the editor is not available yet");
    expect(markup).toContain("never saved in the project");
  });
});
