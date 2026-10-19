// SPDX-License-Identifier: Apache-2.0
// Public entry of the safe file publication engine in ./safe-file/ (docs/safe-file-publication.md).
export {
  type SafeFilePublication,
  type SafeFileOwnership,
  type SafeFilePublicationWithOwnership,
  type PreparedSafeFilePublication,
  type PreparedPublicationDependencies,
  type PublicationInspectionDependencies,
  type FilePublicationDestinationState,
  type DeterministicRemovalDependencies,
  type SafeRegularFileQuarantine,
  SafeFileConflictError,
} from "./safe-file/types.js";
export {
  preparedFileStagePaths,
} from "./safe-file/paths.js";
export {
  publishFileSafely,
  publishFileSafelyWithOwnership,
} from "./safe-file/publish.js";
export {
  prepareFilePublication,
  inspectFilePublicationDestination,
  removeFileWithDeterministicQuarantine,
} from "./safe-file/prepare.js";
export {
  quarantineRegularFileSafely,
  removeRegularFileSafely,
} from "./safe-file/remove.js";
