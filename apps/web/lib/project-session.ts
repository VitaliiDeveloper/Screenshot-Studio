// SPDX-License-Identifier: Apache-2.0

export interface ProjectSourceCapabilities {
  writeInPlace: boolean;
  revealLocation: boolean;
  watchExternalChanges: boolean;
  nativePicker: boolean;
  projectLocalResources: boolean;
}

export interface ActiveProjectDescriptor {
  sessionId: string;
  name: string;
  sourceKind: string;
  displayLocation?: string;
  capabilities: ProjectSourceCapabilities;
}
