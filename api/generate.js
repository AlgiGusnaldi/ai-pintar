// api/generate.js
// Backend serverless function (Vercel)
// Mode teks (listing, ads, screenshot) -> Gemini API
// Mode foto (image edit)             -> Hugging Face Inference API

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mode, images, fields, styles } = req.body;

    if (!mode) {
      return res.status(400).json({ error: "Mode wajib diisi." });
    }

    if (!images || images.length === 0) {
      return res
        .status(400)
        .json({ error: "Minimal upload 1 foto/screenshot." });
    }

    // ============================================================
    // MODE FOTO — HUGGING FACE
    // ============================================================
    if (mode === "foto") {
      const hfToken = process.env.HF_TOKEN;

      if (!hfToken) {
        return res.status(500).json({
          error:
            "HF_TOKEN belum diset di Environment Variable Vercel.",
        });
      }

      if (!styles || styles.length === 0) {
        return res.status(400).json({
          error: "Pilih minimal 1 gaya foto.",
        });
      }

      const styleToPrompt = {
        "Background Putih Polos":
          "professional e-commerce product photo, clean plain white studio background, even soft lighting, sharp focus, realistic product photography",

        "Enhance Cahaya & Ketajaman":
          "enhance the same product photo, brighter natural lighting, sharper details, higher clarity, professional studio photography, preserve the original product",

        "Background Studio":
          "professional e-commerce product photo on a premium studio background with a soft grey gradient, clean dramatic catalog lighting, realistic photography",

        "Background Lifestyle":
          "realistic professional product photo placed in a cozy lifestyle setting appropriate for the product, natural lighting, product remains the main focus",

        "Tambah Badge Best Seller":
          "professional product photo with a small tasteful BEST SELLER badge in the top corner, preserve the original product appearance",

        "Tambah Watermark Brand":
          "professional product photo with a small subtle brand watermark in the bottom corner, preserve the original product appearance",
      };

      const baseImage = images[0];
      const results = [];

      /*
       * Hugging Face model.
       *
       * Model:
       * black-forest-labs/FLUX.1-Kontext-dev
       *
       * This is an image editing model and is suitable for
       * instruction-based image editing.
       */
      const model =
        "black-forest-labs/FLUX.1-Kontext-dev";

      async function callHuggingFace(promptText) {
        try {
          // Convert base64 from frontend to binary
          const imageBuffer = Buffer.from(
            baseImage.base64,
            "base64"
          );

          /*
           * Hugging Face Inference API:
           *
           * The request uses multipart/form-data:
           * - prompt
           * - input image
           */

          const formData = new FormData();

          formData.append("prompt", promptText);

          const blob = new Blob([imageBuffer], {
            type: baseImage.mediaType || "image/jpeg",
          });

          formData.append(
            "image",
            blob,
            "product-image.jpg"
          );

          const hfRes = await fetch(
            `https://router.huggingface.co/hf-inference/models/${model}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${hfToken}`,
              },
              body: formData,
            }
          );

          if (!hfRes.ok) {
            const errorText = await hfRes.text();

            console.error(
              "Hugging Face error:",
              errorText
            );

            return {
              success: false,
              error:
                "Hugging Face error: " +
                errorText.slice(0, 500),
            };
          }

          // Hugging Face returns image binary
          const arrayBuffer =
            await hfRes.arrayBuffer();

          const base64Out = Buffer.from(
            arrayBuffer
          ).toString("base64");

          return {
            success: true,
            base64: base64Out,
            mimeType:
              hfRes.headers.get("content-type") ||
              "image/png",
          };
        } catch (err) {
          console.error(
            "Hugging Face fetch error:",
            err
          );

          return {
            success: false,
            error:
              "Gagal menghubungi Hugging Face: " +
              String(err),
          };
        }
      }

      // Generate setiap gaya yang dipilih
      for (const style of styles) {
        const promptText =
          styleToPrompt[style] ||
          `professional product photography, ${style}, preserve the original product`;

        const result =
          await callHuggingFace(promptText);

        if (result.success) {
          results.push({
            style,
            mimeType: result.mimeType,
            base64: result.base64,
          });
        } else {
          results.push({
            style,
            error: result.error,
          });
        }
      }

      return res.status(200).json({
        result: {
          images: results,
        },
      });
    }

    // ============================================================
    // MODE TEKS — GEMINI API
    // ============================================================

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          "GEMINI_API_KEY belum diset di environment variable Vercel.",
      });
    }

    let promptText = "";

    // ============================================================
    // LISTING
    // ============================================================

    if (mode === "listing") {
      promptText = `Buatkan listing produk marketplace Indonesia berdasarkan foto yang dilampirkan.
Nama: ${fields.nama || "-"}
Kategori: ${fields.kategori || "tebak dari foto"}
Harga: ${fields.harga || "-"}
Bahan/Spesifikasi: ${fields.bahan || "tebak dari foto"}
Gaya bahasa: ${fields.gaya || "Formal"}

Buat 3 versi berbeda satu sama lain:

1. Shopee:
judul singkat SEO-friendly (maks 100 karakter) + deskripsi dengan bullet point keunggulan

2. Tokopedia:
judul + deskripsi naratif yang meyakinkan

3. TikTok Shop:
judul catchy + deskripsi singkat dengan hook di awal, gaya santai

Hindari kalimat generik/pasaran seperti "kualitas terbaik" tanpa alasan spesifik.

Balas HANYA JSON tanpa markdown fence:

{
  "shopee": {
    "judul": "...",
    "deskripsi": "..."
  },
  "tokopedia": {
    "judul": "...",
    "deskripsi": "..."
  },
  "tiktok": {
    "judul": "...",
    "deskripsi": "..."
  }
}`;
    }

    // ============================================================
    // ADS
    // ============================================================

    else if (mode === "ads") {
      promptText = `Buatkan 3 variasi hook & angle iklan Meta Ads untuk produk fisik di foto ini.

Nama produk: ${fields.nama || "-"}
Masalah yang diselesaikan: ${fields.masalah || "-"}
Target pembeli: ${fields.target || "umum"}

Tiap variasi harus beda angle/pendekatan.

Sertakan:
- hook pembuka
- isi singkat
- CTA

Balas HANYA JSON tanpa markdown fence:

{
  "v1": {
    "hook": "...",
    "isi": "...",
    "cta": "..."
  },
  "v2": {
    "hook": "...",
    "isi": "...",
    "cta": "..."
  },
  "v3": {
    "hook": "...",
    "isi": "...",
    "cta": "..."
  }
}`;
    }

    // ============================================================
    // SCREENSHOT
    // ============================================================

    else if (mode === "screenshot") {
      promptText = `Analisis pola/struktur iklan pada screenshot yang dilampirkan.

Analisis:
- jenis hook
- angle masalah
- tone
- struktur CTA

Jelaskan polanya, jangan kutip teks aslinya persis.

Lalu buatkan copy iklan BARU dengan pola serupa
(bukan niru mentah) untuk produk ini:

Nama produk: ${fields.nama || "-"}
Keunggulan produk: ${fields.keunggulan || "-"}

Balas HANYA JSON tanpa markdown fence:

{
  "pola": "...",
  "copy_baru": "..."
}`;
    }

    // ============================================================
    // MODE TIDAK DIKENALI
    // ============================================================

    else {
      return res.status(400).json({
        error: "Mode tidak dikenali.",
      });
    }

    // ============================================================
    // KIRIM KE GEMINI
    // ============================================================

    const parts = [
      ...images.map((img) => ({
        inline_data: {
          mime_type: img.mediaType,
          data: img.base64,
        },
      })),
      {
        text: promptText,
      },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts,
            },
          ],
        }),
      }
    );

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error(
        "Gemini error:",
        data
      );

      return res.status(502).json({
        error: "Gagal memanggil Gemini API.",
        detail: data,
      });
    }

    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]
        ?.text || "";

    const cleaned = rawText
      .replace(/```json|```/g, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error(
        "Gagal parse JSON dari Gemini:",
        rawText
      );

      return res.status(502).json({
        error:
          "AI memberi format yang tidak terbaca, coba generate ulang.",
        raw: rawText,
      });
    }

    return res.status(200).json({
      result: parsed,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error: "Terjadi kesalahan server.",
      detail: String(err),
    });
  }
}
