import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { getTransporter } from "@/lib/mail";

/**
 * The concrete way to confirm "the emailing system is implemented" - not
 * just that Settings saved a provider/host/port, but that mail actually
 * leaves the server. Sends to the logged-in admin's own email so no
 * separate recipient needs to be picked.
 */
export async function POST() {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const recipient = db.users.find((u) => u.id === auth.session.userId);
  if (!recipient?.email) {
    return NextResponse.json({ error: "Your account has no email address set - add one on your Profile page first." }, { status: 400 });
  }

  const transporter = getTransporter(db.settings.notification);
  if (!transporter) {
    return NextResponse.json(
      { error: "Email sending isn't configured - check Provider/SMTP host/port here and SMTP_USER/SMTP_PASSWORD in .env.local. See EMAIL_SETUP.md." },
      { status: 400 }
    );
  }

  try {
    await transporter.sendMail({
      from: db.settings.notification.fromAddress,
      to: recipient.email,
      subject: "NIB Control360 - test email",
      text: "This is a test email from NIB Control360's Notification Delivery settings. If you received this, outbound email is working.",
      html: "<p>This is a test email from NIB Control360&apos;s Notification Delivery settings. If you received this, outbound email is working.</p>",
    });
  } catch (err) {
    // Logged in full server-side only - a raw SMTP transport error can
    // include internal hostnames, auth-failure specifics, or TLS details
    // that shouldn't reach the client even though this endpoint is
    // admin-only. The generic message still points at exactly what to
    // check, without echoing the exception itself.
    console.error("[test-email] Failed to send test email:", err);
    return NextResponse.json(
      { error: "Failed to send - check the server logs and your SMTP host/port/credentials." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sentTo: recipient.email });
}
