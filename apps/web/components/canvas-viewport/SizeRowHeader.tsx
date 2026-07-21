// SPDX-License-Identifier: Apache-2.0

import { OutputIdentityHeader } from "../editor-ui/OutputIdentityHeader.js";

/** Variant adapter for the shared overview output identity primitive. */
export function SizeRowHeader({
  label,
  sizeLabel,
  editing,
}: {
  label: string;
  sizeLabel: string;
  editing: boolean;
}) {
  return (
    <OutputIdentityHeader
      label={label}
      editing={editing}
      sizeLabel={sizeLabel}
      role="variant"
    />
  );
}
