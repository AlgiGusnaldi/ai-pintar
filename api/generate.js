// api/generate.js
// Backend serverless function (Vercel)
// Mode teks (listing, ads, screenshot) -> Gemini API
// Mode foto (image edit)             -> Cloudflare Workers AI (gratis)
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mode, images, fields, styles } = req.body;
    if (!mode) return res.status(400).json({ error: "Mode wajib diisi." });
    if (!images || images.length === 0) {
      return res.status(400).json({ error: "Minimal upload 1 foto/screenshot." });
    }

    // ===== MODE FOTO — Cloudflare Workers AI (gratis) =====
    if (mode === "foto") {
      const cfAccountId = process.env.CF_ACCOUNT_ID;
      const cfToken = process.env.CF_API_TOKEN;
      if (!cfAccountId || !cfToken) {
        return res.status(500).json({ error: "CF_ACCOUNT_ID / CF_API_TOKEN belum diset di environment variable Vercel." });
      }
      if (!styles || styles.length === 0) {
        return res.status(400).json({ error: "Pilih minimal 1 gaya foto." });
      }

      const styleToPrompt = {
        "Background Putih Polos": "product photo on a clean plain white studio background, even soft lighting, product in sharp focus, professional e-commerce photo",
        "Enhance Cahaya & Ketajaman": "the same product photo, brighter, sharper, higher clarity, professional studio lighting, same background",
        "Background Studio": "product photo on a professional studio background with soft grey gradient, dramatic catalog-style lighting",
        "Background Lifestyle": "product photo placed in a cozy lifestyle setting relevant to the product, natural light, product remains the main focus",
        "Tambah Badge Best Seller": "product photo with a small colorful BEST SELLER badge label in the top corner, product unchanged",
        "Tambah Watermark Brand": "product photo with a small subtle brand watermark text in the bottom corner, product unchanged"
      };

      const baseImage = images[0]; // pakai foto pertama sebagai sumber
      const results = [];

      for (const style of styles) {
        const promptText = styleToPrompt[style] || `product photo, style: ${style}`;

        try {
          const cfRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${cfToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: promptText,
                image_b64: baseImage.base64,
                num_steps: 20,
                strength: 0.55, // 0-1, makin kecil makin mirip foto asli
                guidance: 7.5,
              }),
            }
          );

          if (!cfRes.ok) {
  const errText = await cfRes.text();
  console.error("Cloudflare AI error:", errText);
  results.push({ style, error: "CF error: " + errText.slice(0, 300) });
  continue;
}

          // Respons sukses = binary image stream (bukan JSON)
          const arrayBuffer = await cfRes.arrayBuffer();
          const base64Out = Buffer.from(arrayBuffer).toString("base64");
          results.push({
            style,
            mimeType: "image/png",
            base64: base64Out,
          });
        } catch (innerErr) {
          console.error("Cloudflare fetch error:", innerErr);
          results.push({ style, error: "Terjadi kesalahan saat memanggil Cloudflare AI." });
        }
      }

      return res.status(200).json({ result: { images: results } });
    }

    // ===== MODE TEKS (listing, ads, screenshot) — Gemini API =====
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY belum diset di environment variable Vercel." });
    }

    let promptText = "";
    if (mode === "listing") {
      promptText = `Buatkan listing produk marketplace Indonesia berdasarkan foto yang dilampirkan.
Nama: ${fields.nama || "-"}
Kategori: ${fields.kategori || "tebak dari foto"}
Harga: ${fields.harga || "-"}
Bahan/Spesifikasi: ${fields.bahan || "tebak dari foto"}
Gaya bahasa: ${fields.gaya || "Formal"}
Buat 3 versi berbeda satu sama lain:
1. Shopee: judul singkat SEO-friendly (maks 100 karakter) + deskripsi dengan bullet point keunggulan
2. Tokopedia: judul + deskripsi naratif yang meyakinkan
3. TikTok Shop: judul catchy + deskripsi singkat dengan hook di awal, gaya santai
Hindari kalimat generik/pasaran seperti "kualitas terbaik" tanpa alasan spesifik.
Balas HANYA JSON tanpa markdown fence: {"shopee":{"judul":"...","deskripsi":"..."},"tokopedia":{"judul":"...","deskripsi":"..."},"tiktok":{"judul":"...","deskripsi":"..."}}`;
    } else if (mode === "ads") {
      promptText = `Buatkan 3 variasi hook & angle iklan Meta Ads untuk produk fisik di foto ini.
Nama produk: ${fields.nama || "-"}
Masalah yang diselesaikan: ${fields.masalah || "-"}
Target pembeli: ${fields.target || "umum"}
Tiap variasi harus beda angle/pendekatan. Sertakan hook pembuka, isi singkat, dan CTA.
Balas HANYA JSON tanpa markdown fence: {"v1":{"hook":"...","isi":"...","cta":"..."},"v2":{"hook":"...","isi":"...","cta":"..."},"v3":{"hook":"...","isi":"...","cta":"..."}}`;
    } else if (mode === "screenshot") {
      promptText = `Analisis pola/struktur iklan pada screenshot yang dilampirkan (jenis hook, angle masalah, tone, struktur CTA) — jelaskan polanya, jangan kutip teks aslinya persis.
Lalu buatkan copy iklan BARU dengan pola serupa (bukan niru mentah) untuk produk ini:
Nama produk: ${fields.nama || "-"}
Keunggulan produk: ${fields.keunggulan || "-"}
Balas HANYA JSON tanpa markdown fence: {"pola":"...","copy_baru":"..."}`;
    } else {
      return res.status(400).json({ error: "Mode tidak dikenali." });
    }

    const parts = [
      ...images.map((img) => ({
        inline_data: { mime_type: img.mediaType, data: img.base64 },
      })),
      { text: promptText },
    ];
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] }),
      }
    );
    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error("Gemini error:", data);
      return res.status(502).json({ error: "Gagal memanggil Gemini API.", detail: data });
    }
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Gagal parse JSON dari Gemini:", rawText);
      return res.status(502).json({ error: "AI memberi format yang tidak terbaca, coba generate ulang.", raw: rawText });
    }
    return res.status(200).json({ result: parsed });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Terjadi kesalahan server.", detail: String(err) });
  }
}
