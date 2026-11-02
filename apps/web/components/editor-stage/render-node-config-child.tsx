// SPDX-License-Identifier: Apache-2.0
"use client";

import { useLayoutEffect, useRef, type Key } from "react";
import Konva from "konva";
import { Text, Rect, Ellipse, Image as KonvaImage, Group, Path } from "react-konva";
import { assertNever } from "@screenshot-studio/core/model";
import { applyNodeFilter, type NodeConfig } from "@screenshot-studio/core/engine";

export function renderNodeConfigChild(child: NodeConfig, key: Key, listening: boolean, name?: string) {
  switch (child.konva) {
    case "Image":
      return <FilteredKonvaImage key={key} nodeConfig={child} name={name} listening={listening} />;
    case "Ellipse":
      return <Ellipse key={key} {...child.config} name={name} listening={listening} />;
    case "Path":
      return <Path key={key} {...child.config} name={name} listening={listening} />;
    case "Rect":
      return <Rect key={key} {...child.config} name={name} listening={listening} />;
    case "Text":
      return <Text key={key} {...child.config} name={name} listening={listening} />;
    case "Group":
      return (
        <Group key={key} {...child.config} name={name} listening={listening}>
          {child.children.map((nested, index) => renderNodeConfigChild(nested, index, listening, name))}
        </Group>
      );
    default:
      return assertNever(child);
  }
}

function FilteredKonvaImage({
  nodeConfig,
  listening,
  name,
}: {
  nodeConfig: Extract<NodeConfig, { konva: "Image" }>;
  listening: boolean;
  name?: string;
}) {
  const imageRef = useRef<Konva.Image>(null);
  useLayoutEffect(() => {
    const node = imageRef.current;
    if (!node) return;
    applyNodeFilter(node, nodeConfig.filter);
    node.getLayer()?.batchDraw();
    return () => {
      node.clearCache();
    };
  }, [nodeConfig.filter]);

  return <KonvaImage ref={imageRef} {...nodeConfig.config} name={name} listening={listening} />;
}
