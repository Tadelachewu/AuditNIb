"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      await apiSend("/api/auth/logout", "POST");
      router.push("/login");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleLogout} disabled={loading}>
      {loading ? "Signing out..." : "Sign out"}
    </Button>
  );
}
