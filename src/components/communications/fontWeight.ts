import { Extension } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontWeight: {
      /** e.g. "300" (light) ... "900" (black) */
      setFontWeight: (fontWeight: string) => ReturnType;
      unsetFontWeight: () => ReturnType;
    };
  }
}

/**
 * Font weight for Communications messages (Tiptap has no ready-made one): a
 * `font-weight` style on the text-style mark, like Tiptap's own FontFamily /
 * FontSize. The server keeps only weights 100-900, normal and bold
 * (src/lib/communications/richText.ts).
 */
export const FontWeight = Extension.create<{ types: string[] }>({
  name: "fontWeight",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontWeight: {
            default: null,
            parseHTML: (element) => element.style.fontWeight || null,
            renderHTML: (attributes) => (attributes.fontWeight ? { style: `font-weight: ${attributes.fontWeight}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontWeight:
        (fontWeight) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontWeight }).run(),
      unsetFontWeight:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontWeight: null }).removeEmptyTextStyle().run(),
    };
  },
});
