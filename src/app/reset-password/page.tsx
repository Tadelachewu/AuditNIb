import { ResetPasswordClient } from "@/components/auth/ResetPasswordClient";

// Server component - reads the querystring token during server render so the
// client component never has to call useSearchParams(), which Next.js 16
// requires to be wrapped in a Suspense boundary when the page is statically
// prerendered or uses partial prerendering (the error the production build
// was hitting: "useSearchParams() should be wrapped in a suspense boundary").
// `searchParams` opts this page into dynamic rendering (fine — reset links
// are always clicked with a fresh `?token=` query anyway, there's nothing
// cacheable here), and passing the resolved string to the client as a prop
// avoids the CSR hook entirely.
export default async function ResetPasswordPage(props: {
  searchParams?: Promise<{ token?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const raw = searchParams?.token;
  const token = Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
  return <ResetPasswordClient token={token} />;
}
