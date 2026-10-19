"use client";

import { useMemo } from "react";
import MenuItem from "@mui/material/MenuItem";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import type { Editor } from "@tiptap/react";
import {
  LinkBubbleMenu,
  LinkBubbleMenuHandler,
  MenuButtonBlockquote,
  MenuButtonBold,
  MenuButtonBulletedList,
  MenuButtonEditLink,
  MenuButtonHighlightColor,
  MenuButtonHorizontalRule,
  MenuButtonItalic,
  MenuButtonOrderedList,
  MenuButtonRedo,
  MenuButtonRemoveFormatting,
  MenuButtonStrikethrough,
  MenuButtonSubscript,
  MenuButtonSuperscript,
  MenuButtonTextColor,
  MenuButtonUnderline,
  MenuButtonUndo,
  MenuControlsContainer,
  MenuDivider,
  MenuSelect,
  MenuSelectFontFamily,
  MenuSelectFontSize,
  MenuSelectHeading,
  MenuSelectTextAlign,
  RichTextEditor,
} from "mui-tiptap";
import { LIMITS } from "@/lib/communications/types";
import { FontWeight } from "./fontWeight";

export interface RichMessageValue {
  html: string;
  /** The plain text (what the 5,000-character limit counts). */
  text: string;
}

/**
 * Font families offered: common Windows / Office fonts with web-safe
 * fallbacks, plus Ethiopic fonts (Nyala, Ebrima) for Amharic text. The value
 * is the CSS font-family stored on the text.
 */
export const FONT_FAMILIES = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Calibri", value: "Calibri, Carlito, sans-serif" },
  { label: "Cambria", value: "Cambria, Caladea, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Segoe UI", value: "'Segoe UI', Tahoma, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Verdana, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Nyala (Amharic)", value: "Nyala, 'Noto Serif Ethiopic', serif" },
  { label: "Ebrima (Amharic)", value: "Ebrima, 'Noto Sans Ethiopic', sans-serif" },
];
export const FONT_SIZES = ["8px", "9px", "10px", "11px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px", "48px"];
export const FONT_WEIGHTS = [
  { label: "Light", value: "300" },
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
  { label: "Bold", value: "700" },
  { label: "Extra bold", value: "800" },
  { label: "Black", value: "900" },
];
export const LINE_HEIGHTS = ["1", "1.15", "1.5", "2", "2.5"];
/** Colour swatches for text and highlight (the picker also takes any colour). */
const SWATCHES = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#ffffff",
  "#b91c1c", "#ea580c", "#ca8a04", "#15803d", "#0d9488", "#0369a1",
  "#1d4ed8", "#6d28d9", "#be185d", "#8a4d21", "#feb914", "#fde68a",
];

/** The editor's extensions: exactly the formatting the server keeps (shared with the tests). */
export function messageExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https", "mailto"] },
    }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    LineHeight,
    FontWeight,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Subscript,
    Superscript,
    Placeholder.configure({ placeholder }),
    LinkBubbleMenuHandler,
  ];
}

/** A toolbar dropdown that sets one text-style value (font weight / line height). */
function StyleSelect({
  editor,
  label,
  current,
  options,
  onPick,
}: {
  editor: Editor | null;
  label: string;
  current: string;
  options: { label: string; value: string }[];
  onPick: (value: string) => void;
}) {
  return (
    <MenuSelect<string>
      value={current}
      displayEmpty
      disabled={!editor?.isEditable}
      tooltipTitle={label}
      aria-label={label}
      onChange={(e) => onPick(e.target.value)}
      renderValue={(v) => (v ? (options.find((o) => o.value === v)?.label ?? v) : label)}
      sx={{ minWidth: 92 }}
    >
      <MenuItem value="">
        <em>Default</em>
      </MenuItem>
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </MenuSelect>
  );
}

/**
 * The Communications message editor (Tiptap, with mui-tiptap's toolbar):
 * headings 1-6, font family, size, weight and line height, bold, italic,
 * underline, strikethrough, sub- and superscript, text and highlight colour,
 * alignment, lists, quotes, a dividing line and links. The server keeps
 * exactly this formatting and removes anything else
 * (src/lib/communications/richText.ts). Pasted content is reduced the same
 * way. Remount it (change its `key`) to clear it.
 */
export function RichMessageEditor({
  id,
  placeholder,
  disabled = false,
  minHeight = 180,
  onChange,
}: {
  id?: string;
  placeholder: string;
  disabled?: boolean;
  minHeight?: number;
  onChange: (value: RichMessageValue) => void;
}) {
  const extensions = useMemo(() => messageExtensions(placeholder), [placeholder]);

  return (
    <RichTextEditor
      extensions={extensions}
      // Rendered in the browser only (the page itself is server-rendered).
      immediatelyRender={false}
      editable={!disabled}
      editorProps={{ attributes: { ...(id ? { id } : {}), "aria-label": placeholder, role: "textbox", "aria-multiline": "true" } }}
      onUpdate={({ editor }) => onChange({ html: editor.isEmpty ? "" : editor.getHTML(), text: editor.getText({ blockSeparator: "\n" }).trim() })}
      sx={{ "& .ProseMirror": { minHeight, fontSize: "0.875rem" } }}
      renderControls={(editor) => (
        <MenuControlsContainer>
          <MenuSelectHeading />
          <MenuSelectFontFamily options={FONT_FAMILIES} />
          <MenuSelectFontSize options={FONT_SIZES} />
          <StyleSelect
            editor={editor}
            label="Weight"
            current={(editor?.getAttributes("textStyle").fontWeight as string | undefined) ?? ""}
            options={FONT_WEIGHTS}
            onPick={(v) => (v ? editor?.chain().focus().setFontWeight(v).run() : editor?.chain().focus().unsetFontWeight().run())}
          />
          <StyleSelect
            editor={editor}
            label="Line height"
            current={(editor?.getAttributes("textStyle").lineHeight as string | undefined) ?? ""}
            options={LINE_HEIGHTS.map((v) => ({ label: v, value: v }))}
            onPick={(v) => (v ? editor?.chain().focus().setLineHeight(v).run() : editor?.chain().focus().unsetLineHeight().run())}
          />
          <MenuDivider />
          <MenuButtonBold />
          <MenuButtonItalic />
          <MenuButtonUnderline />
          <MenuButtonStrikethrough />
          <MenuButtonSubscript />
          <MenuButtonSuperscript />
          <MenuDivider />
          <MenuButtonTextColor defaultTextColor="#000000" swatchColors={SWATCHES.map((value) => ({ value }))} />
          <MenuButtonHighlightColor swatchColors={SWATCHES.map((value) => ({ value }))} />
          <MenuDivider />
          <MenuSelectTextAlign />
          <MenuDivider />
          <MenuButtonBulletedList />
          <MenuButtonOrderedList />
          <MenuButtonBlockquote />
          <MenuButtonHorizontalRule />
          <MenuDivider />
          <MenuButtonEditLink />
          <MenuButtonRemoveFormatting />
          <MenuDivider />
          <MenuButtonUndo />
          <MenuButtonRedo />
        </MenuControlsContainer>
      )}
    >
      {() => <LinkBubbleMenu />}
    </RichTextEditor>
  );
}

/** "123 / 5000", red when over the limit. */
export function TextCounter({ text }: { text: string }) {
  const over = text.length > LIMITS.body;
  return (
    <p className={`mt-1 text-right text-xs ${over ? "text-red-600" : "text-slate-500"}`}>
      {text.length} / {LIMITS.body}
    </p>
  );
}
