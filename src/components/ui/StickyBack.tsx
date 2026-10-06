import Link from "next/link";

/**
 * The gold "← Back" button of a detail / report page, on a bar that stays in
 * view while the page scrolls. The bar runs edge to edge across the content
 * area - flush with the sidebar's border on the left and right under the top
 * bar's bottom border (top-16 = the top bar's h-16; -mx-6/-mt-6 cancel
 * <main>'s p-6) - with its own bottom border, so it reads as part of the
 * header. Must be the first child of the page's outer column. Hidden when
 * printing.
 */
export function StickyBack({ href }: { href: string }) {
  return (
    <div className="no-print sticky top-16 z-10 -mx-6 -mt-6 border-b border-chrome-border bg-page px-6 py-2">
      <Link
        href={href}
        className="inline-flex items-center rounded-md bg-brand-gold px-3 py-1.5 text-sm font-bold text-on-gold transition-colors hover:bg-brand-gold-dark"
      >
        ← Back
      </Link>
    </div>
  );
}
