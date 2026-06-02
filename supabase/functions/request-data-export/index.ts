import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExportPayload = {
  auth: { email: string | undefined; phone: string | undefined };
  profile: unknown;
  recent_destinations: unknown[];
  dependents: unknown[];
  bookings: unknown[];
  shipments: unknown[];
  dependent_shipments: unknown[];
  notification_preferences: unknown[];
  excursion_requests: unknown[];
  exported_at: string;
};

function buildPdfLines(payload: ExportPayload): string[] {
  const lines: string[] = [];
  const push = (arr: string[]) => arr.forEach((s) => lines.push(s));

  lines.push("— CÓPIA DOS SEUS DADOS (Take Me) —");
  lines.push(`Exportado em: ${payload.exported_at}`);
  lines.push("");

  push(["=== CONTA (Auth) ==="]);
  lines.push(`E-mail: ${payload.auth.email ?? "(não informado)"}`);
  lines.push(`Telefone: ${payload.auth.phone ?? "(não informado)"}`);
  lines.push("");

  push(["=== PERFIL ==="]);
  const p = payload.profile as Record<string, unknown> | null;
  if (p) {
    Object.entries(p).forEach(([k, v]) => lines.push(`${k}: ${v === null || v === undefined ? "" : String(v)}`));
  } else {
    lines.push("(sem dados)");
  }
  lines.push("");

  push(["=== DESTINOS RECENTES ==="]);
  if (payload.recent_destinations.length) {
    payload.recent_destinations.forEach((d: unknown, i: number) => {
      const o = d as Record<string, unknown>;
      lines.push(`${i + 1}. ${o.address ?? ""} — ${o.city ?? ""}`);
    });
  } else {
    lines.push("(nenhum)");
  }
  lines.push("");

  push(["=== DEPENDENTES ==="]);
  if (payload.dependents.length) {
    payload.dependents.forEach((d: unknown, i: number) => {
      const o = d as Record<string, unknown>;
      lines.push(`${i + 1}. ${o.full_name ?? ""} — status: ${o.status ?? ""}`);
    });
  } else {
    lines.push("(nenhum)");
  }
  lines.push("");

  push(["=== RESERVAS (Bookings) ==="]);
  if (payload.bookings.length) {
    payload.bookings.forEach((b: unknown, i: number) => {
      const o = b as Record<string, unknown>;
      lines.push(`${i + 1}. ${o.origin_address ?? ""} → ${o.destination_address ?? ""} — status: ${o.status ?? ""}`);
    });
  } else {
    lines.push("(nenhuma)");
  }
  lines.push("");

  push(["=== ENVIOS (Shipments) ==="]);
  if (payload.shipments.length) {
    payload.shipments.forEach((s: unknown, i: number) => {
      const o = s as Record<string, unknown>;
      lines.push(`${i + 1}. ${o.origin_address ?? ""} → ${o.destination_address ?? ""} — status: ${o.status ?? ""}`);
    });
  } else {
    lines.push("(nenhum)");
  }
  lines.push("");

  push(["=== ENVIOS DE DEPENDENTES ==="]);
  if (payload.dependent_shipments.length) {
    payload.dependent_shipments.forEach((s: unknown, i: number) => {
      const o = s as Record<string, unknown>;
      lines.push(`${i + 1}. ${o.full_name ?? ""} — ${o.origin_address ?? ""} → ${o.destination_address ?? ""} — status: ${o.status ?? ""}`);
    });
  } else {
    lines.push("(nenhum)");
  }
  lines.push("");

  push(["=== PREFERÊNCIAS DE NOTIFICAÇÃO ==="]);
  if (payload.notification_preferences.length) {
    payload.notification_preferences.forEach((n: unknown) => {
      const o = n as Record<string, unknown>;
      lines.push(`${o.key ?? ""}: ${o.enabled ? "ativado" : "desativado"}`);
    });
  } else {
    lines.push("(nenhuma)");
  }
  lines.push("");

  push(["=== EXCURSÕES ==="]);
  if (payload.excursion_requests.length) {
    payload.excursion_requests.forEach((er: unknown, i: number) => {
      const o = er as Record<string, unknown>;
      const passengers = (o.excursion_passengers as unknown[]) ?? [];
      lines.push(`${i + 1}. Destino: ${o.destination ?? ""} — Data: ${o.excursion_date ?? ""} — Status: ${o.status ?? ""}`);
      passengers.forEach((p: unknown, j: number) => {
        const pp = p as Record<string, unknown>;
        lines.push(`   Passageiro ${j + 1}: ${pp.full_name ?? ""}`);
      });
    });
  } else {
    lines.push("(nenhuma)");
  }

  return lines;
}

/** Remove ou substitui caracteres que o Helvetica (WinAnsi) não suporta para evitar erro no drawText. */
function toPdfSafeText(s: string): string {
  const map: Record<string, string> = {
    "á": "a", "à": "a", "ã": "a", "â": "a", "ä": "a",
    "é": "e", "è": "e", "ê": "e", "ë": "e",
    "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ó": "o", "ò": "o", "õ": "o", "ô": "o", "ö": "o",
    "ú": "u", "ù": "u", "û": "u", "ü": "u",
    "ç": "c", "ñ": "n",
    "Á": "A", "À": "A", "Ã": "A", "Â": "A",
    "É": "E", "È": "E", "Ê": "E",
    "Í": "I", "Ì": "I", "Î": "I",
    "Ó": "O", "Ò": "O", "Õ": "O", "Ô": "O",
    "Ú": "U", "Ù": "U", "Û": "U",
    "Ç": "C", "Ñ": "N",
  };
  return Array.from(s, (c) => map[c] ?? (c.codePointAt(0)! < 128 ? c : "?")).join("");
}

async function createPdf(payload: ExportPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const lineHeight = fontSize * 1.3;
  const margin = 50;
  const pageWidth = 595;
  const pageHeight = 842;
  let y = pageHeight - margin;
  let page = doc.addPage([pageWidth, pageHeight]);

  const lines = buildPdfLines(payload);
  const maxWidth = pageWidth - 2 * margin;

  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      const safeLine = toPdfSafeText(trimmed);
      const chunks = safeLine.length > 90 ? safeLine.match(/.{1,90}(\s|$)/g) ?? [safeLine] : [safeLine];
      for (const chunk of chunks) {
        if (y < margin) {
          page = doc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(chunk, {
          x: margin,
          y,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
          maxWidth,
        });
        y -= lineHeight;
      }
    } else {
      y -= lineHeight;
    }
  }

  return doc.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Não autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let user: { id: string; email?: string | null; phone?: string | null };
    try {
      const anonClient = createClient(supabaseUrl, anonKey);
      const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
      if (claimsError || !claimsData?.claims?.sub) {
        console.error("[request-data-export] getClaims failed:", claimsError?.message ?? "no sub");
        return new Response(
          JSON.stringify({ error: "Sessão inválida ou expirada" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const userId = claimsData.claims.sub as string;
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const { data: { user: authUser }, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError || !authUser) {
        console.error("[request-data-export] getUserById failed:", userError?.message);
        return new Response(
          JSON.stringify({ error: "Sessão inválida ou expirada" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      user = authUser;
    } catch (authErr) {
      console.error("[request-data-export] auth step:", authErr);
      return new Response(
        JSON.stringify({ error: "Erro ao validar sessão. Tente novamente." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const [
      { data: profile },
      { data: recent_destinations },
      { data: dependents },
      { data: bookings },
      { data: shipments },
      { data: dependent_shipments },
      { data: notification_preferences },
      { data: excursion_requests },
    ] = await Promise.all([
      userClient.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      userClient.from("recent_destinations").select("*").order("used_at", { ascending: false }),
      userClient.from("dependents").select("*").order("created_at", { ascending: true }),
      userClient.from("bookings").select("*").order("created_at", { ascending: false }),
      userClient.from("shipments").select("*").order("created_at", { ascending: false }),
      userClient.from("dependent_shipments").select("*").order("created_at", { ascending: false }),
      userClient.from("notification_preferences").select("*"),
      userClient.from("excursion_requests").select("*, excursion_passengers(*)").order("created_at", { ascending: false }),
    ]);

    const exported_at = new Date().toISOString();
    const payload: ExportPayload = {
      auth: { email: user.email ?? undefined, phone: user.phone ?? undefined },
      profile: profile ?? null,
      recent_destinations: recent_destinations ?? [],
      dependents: dependents ?? [],
      bookings: bookings ?? [],
      shipments: shipments ?? [],
      dependent_shipments: dependent_shipments ?? [],
      notification_preferences: notification_preferences ?? [],
      excursion_requests: excursion_requests ?? [],
      exported_at,
    };

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await createPdf(payload);
    } catch (pdfErr) {
      console.error("[request-data-export] createPdf:", pdfErr);
      return new Response(
        JSON.stringify({ error: "Erro ao gerar relatório. Tente novamente." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retorna o PDF em base64 para o app gravar e compartilhar in-app
    // (folha de compartilhamento nativa / "Salvar em Arquivos").
    let pdfBinary = "";
    for (let i = 0; i < pdfBytes.length; i++) pdfBinary += String.fromCharCode(pdfBytes[i]);
    const pdfBase64 = btoa(pdfBinary);
    const filename = `meus-dados-takeme-${exported_at.slice(0, 10)}.pdf`;

    // Registro de auditoria (LGPD) — não bloqueia a exportação se falhar.
    try {
      await admin.from("data_export_requests").upsert(
        { user_id: user.id, last_sent_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    } catch (auditErr) {
      console.warn("[request-data-export] audit upsert:", auditErr);
    }

    return new Response(
      JSON.stringify({ ok: true, pdf_base64: pdfBase64, filename }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[request-data-export]", msg, stack);
    return new Response(
      JSON.stringify({ error: "Erro interno. Tente novamente mais tarde." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
