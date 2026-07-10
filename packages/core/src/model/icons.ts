// SPDX-License-Identifier: Apache-2.0
import { ICON_IDS, type IconId } from "./schema.js";

/** Trusted normalised SVG path data. Documents persist only these stable ids, never raw markup. */
export const ICON_PATHS: Readonly<Record<IconId, string>> = {
  check: "M4 12.5L9.5 18L20 6",
  heart: "M12 21S3 15.5 3 9.5C3 5.5 8 3.5 12 7.5C16 3.5 21 5.5 21 9.5C21 15.5 12 21 12 21Z",
  sparkles: "M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2ZM19 16L19.8 18.2L22 19L19.8 19.8L19 22L18.2 19.8L16 19L18.2 18.2Z",
  star: "M12 2.5L14.9 8.4L21.5 9.4L16.75 14L17.9 20.5L12 17.4L6.1 20.5L7.25 14L2.5 9.4L9.1 8.4Z",
};

if (Object.keys(ICON_PATHS).length !== ICON_IDS.length) {
  throw new Error("Icon path registry is out of sync with ICON_IDS");
}
