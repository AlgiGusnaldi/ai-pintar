// api/generate.js
// Backend serverless function (Vercel)
// Mode teks (listing, ads, screenshot) -> Gemini API
// Mode foto (image edit)             -> Cloudflare Workers AI (gratis, dengan retry)
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

    // ===== MODE FOTO — Cloudflare Workers AI (gratis, dengan retry) =====
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

      // Hanya pakai 1 model — model lain (dreamshaper, dll) beda format input,
      // tidak kompatibel dengan image_b64 img2img seperti ini
      const modelsToTry = ["@cf/runwayml/stable-diffusion-v1-5-img2img"];

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      async function callCloudflareWithRetry(promptText) {
        const maxRetriesPerModel = 5;

        for (const model of modelsToTry) {
          for (let attempt = 1; attempt <= maxRetriesPerModel; attempt++) {
            try {
              const cfRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${model}`,
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
                    strength: 0.55,
                    guidance: 7.5,
                  }),
                }
              );

              if (cfRes.ok) {
                // Sukses — respons binary image stream
                const arrayBuffer = await cfRes.arrayBuffer();
                const base64Out = Buffer.from(arrayBuffer).toString("base64");
                return { success: true, base64: base64Out, mimeType: "image/png" };
              }

              // Kalau gagal, cek apakah karena capacity exceeded (bisa di-retry)
              const errText = await cfRes.text();
              const isCapacityIssue =
                errText.includes("3040") || errText.toLowerCase().includes("capacity");

              console.error(
                `Cloudflare AI error (model: ${model}, attempt: ${attempt}):`,
                errText
              );

              if (isCapacityIssue && attempt < maxRetriesPerModel) {
                // Tunggu sebentar sebelum coba lagi (backoff bertahap, makin lama tiap gagal)
                await sleep(2000 * attempt);
                continue;
              }

              if (isCapacityIssue) {
                // Sudah retry maksimal di model ini, lanjut coba model berikutnya
                break;
              }

              // Error lain (bukan capacity) — langsung berhenti, gak perlu retry
              return { success: false, error: "CF error: " + errText.slice(0, 300) };
            } catch (innerErr) {
              console.error(`Cloudflare fetch error (model: ${model}, attempt: ${attempt}):`, innerErr);
              if (attempt < maxRetriesPerModel) {
                await sleep(1500 * attempt);
                continue;
              }
              break;
            }
          }
        }

        return {
          success: false,
          error: "Server Cloudflare AI sedang penuh setelah beberapa kali dicoba. Coba lagi beberapa saat lagi.",
        };
      }

      for (const style of styles) {
        const promptText = styleToPrompt[style] || `product photo, style: ${style}`;
        const result = await callCloudflareWithRetry(promptText);

        if (result.success) {
          results.push({ style, mimeType: result.mimeType, base64: result.base64 });
        } else {
          results.push({ style, error: result.error });
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
