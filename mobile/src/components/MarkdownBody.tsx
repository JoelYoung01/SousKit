import { parseMarkdown, type BlockNode, type InlineNode, type ListBlock } from "@/lib/markdown";
import { cn } from "@/lib/cn";
import { Fragment, type ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";

type Tone = {
  strong?: boolean;
  em?: boolean;
  link?: boolean;
};

export function MarkdownBody({
  source,
  blocks,
  size = "base",
  className
}: {
  source?: string | null;
  blocks?: BlockNode[];
  size?: "sm" | "base";
  className?: string;
}) {
  const resolved = blocks ?? parseMarkdown(source || "");
  if (!resolved.length) return null;
  return (
    <View className={cn("gap-2.5", className)}>
      {resolved.map((block, index) => (
        <BlockView key={index} block={block} size={size} />
      ))}
    </View>
  );
}

function bodyTextClass(size: "sm" | "base") {
  return size === "sm"
    ? "font-sans text-sm leading-5 text-muted-foreground"
    : "font-sans text-base leading-6 text-muted-foreground";
}

function headingClass(level: 1 | 2 | 3, size: "sm" | "base") {
  if (size === "sm" || level === 3) return "font-sans-semibold text-sm leading-5 text-foreground";
  if (level === 1) return "font-sans-semibold text-lg leading-6 text-foreground";
  return "font-sans-semibold text-base leading-6 text-foreground";
}

function BlockView({ block, size }: { block: BlockNode; size: "sm" | "base" }) {
  if (block.type === "heading") {
    return (
      <Text className={headingClass(block.level, size)}>
        <Inlines nodes={block.children} />
      </Text>
    );
  }
  if (block.type === "paragraph") {
    return (
      <Text className={bodyTextClass(size)}>
        <Inlines nodes={block.children} />
      </Text>
    );
  }
  return <ListView block={block} size={size} />;
}

function ListView({ block, size }: { block: ListBlock; size: "sm" | "base" }) {
  return (
    <View className="gap-2">
      {block.items.map((item, index) => {
        const marker = block.ordered ? `${block.start + index}.` : "•";
        return (
          <View key={index} className="gap-1">
            <View className="flex-row gap-2">
              <Text className={bodyTextClass(size)}>{marker}</Text>
              <Text className={cn("flex-1", bodyTextClass(size))}>
                <Inlines nodes={item.children} />
              </Text>
            </View>
            {item.nested ? (
              <View className="pl-4">
                <ListView block={item.nested} size={size} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Inlines({ nodes, tone }: { nodes: InlineNode[]; tone?: Tone }) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={index}>{renderInline(node, tone)}</Fragment>
      ))}
    </>
  );
}

function renderInline(node: InlineNode, tone?: Tone): ReactNode {
  if (node.type === "text") {
    if (!tone?.strong && !tone?.em && !tone?.link) return node.text;
    return <Text className={inlineClass(tone)}>{node.text}</Text>;
  }
  if (node.type === "break") return "\n";
  if (node.type === "code") {
    return (
      <Text className="font-sans text-foreground" style={{ fontFamily: "monospace" }}>
        {node.text}
      </Text>
    );
  }
  if (node.type === "strong") {
    return (
      <Text className={inlineClass({ ...tone, strong: true })}>
        <Inlines nodes={node.children} tone={{ ...tone, strong: true }} />
      </Text>
    );
  }
  if (node.type === "em") {
    return (
      <Text className={inlineClass({ ...tone, em: true })}>
        <Inlines nodes={node.children} tone={{ ...tone, em: true }} />
      </Text>
    );
  }
  return (
    <Text
      accessibilityRole="link"
      className={inlineClass({ ...tone, link: true, strong: true })}
      onPress={() => {
        Linking.openURL(node.href).catch(() => undefined);
      }}
    >
      <Inlines nodes={node.children} tone={{ ...tone, link: true, strong: true }} />
    </Text>
  );
}

function inlineClass(tone?: Tone) {
  const family =
    tone?.strong && tone?.em
      ? "font-sans-semibold-italic"
      : tone?.strong
        ? "font-sans-semibold"
        : tone?.em
          ? "font-sans-italic"
          : "font-sans";
  if (tone?.link) return cn(family, "text-[#22c55e] underline");
  if (tone?.strong) return cn(family, "text-foreground");
  return family;
}

export function MarkdownPreviewToggle({
  mode,
  onChange
}: {
  mode: "write" | "preview";
  onChange: (mode: "write" | "preview") => void;
}) {
  return (
    <View className="flex-row rounded-lg bg-secondary/60 p-0.5">
      {(["write", "preview"] as const).map((value) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === value }}
          onPress={() => onChange(value)}
          className={cn("rounded-md px-2 py-1", mode === value ? "bg-card" : "")}
        >
          <Text
            className={cn(
              "font-sans-semibold text-xs",
              mode === value ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {value === "write" ? "Write" : "Preview"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
