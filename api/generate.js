# `api/generate.js`

````javascript
// api/generate.js
// Backend serverless function (Vercel)
//
// MODE TEKS:
// listing, ads, screenshot -> Gemini API
//
// MODE FOTO:
// image editing -> Hugging Face Inference Providers
//
// Environment Variables Vercel:
// HF_TOKEN
// GEMINI_API_KEY

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const {
      mode,
      images,
      fields = {},
      styles = [],
    } = req.body || {};

    if (!mode) {
      return res.status(400).json({
        error: "Mode wajib diisi.",
      });
    }

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        error: "Minimal upload 1 foto/screenshot.",
      });
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
          "Edit this exact product photo. Keep the product itself unchanged. Place it on a clean pure white e-commerce studio background. Soft even professional lighting, realistic photography, sharp details, natural shadows. Do not redesign, replace, distort, or change the product.",

        "Enhance Cahaya & Ketajaman":
          "Enhance this exact product photo while preserving the original product completely. Improve natural lighting, exposure, sharpness, clarity and detail. Make it look like a professional e-commerce studio photograph. Do not change the product shape, color, branding, text, packaging, or proportions.",

        "Background Studio":
          "Edit this exact product photo. Preserve the original product exactly. Replace only the background with a premium professional studio environment using a subtle soft grey gradient, realistic catalog lighting and natural shadow. Do not alter the product.",

        "Background Lifestyle":
          "Edit this exact product photo. Preserve the original product exactly. Place the product naturally in an attractive realistic lifestyle environment appropriate for the product. Professional commercial photography, natural lighting, realistic perspective. The product must remain the main focus and must not be redesigned.",

        "Tambah Badge Best Seller":
          "Edit this exact product photo. Preserve the original product completely. Add a small tasteful BEST SELLER badge in an appropriate corner of the image. Keep the badge subtle and professional. Do not change the product, packaging, branding, logo, colors, shape, or text.",

        "Tambah Watermark Brand":
          "Edit this exact product photo. Preserve the original product completely. Add a small subtle brand watermark in the bottom corner. Keep it professional and unobtrusive. Do not alter the original product.",
      };

      const baseImage = images[0];

      if (!baseImage.base64) {
        return res.status(400).json({
          error: "Data gambar tidak ditemukan.",
        });
      }

      const results = [];

      /*
       * Hugging Face Inference Providers
       *
       * Model image editing:
       * black-forest-labs/FLUX.1-Kontext-dev
       *
       * Hugging Face documents this model as an
       * image-to-image model suitable for image editing.
       */

      const model =
        "black-forest-labs/FLUX.1-Kontext-dev";

      async function callHuggingFace(promptText) {
        try {
          /*
           * Convert frontend base64 -> binary
           */
          const imageBuffer = Buffer.from(
            baseImage.base64,
            "base64"
          );

          /*
           * Use multipart/form-data.
           *
           * We deliberately do NOT manually set
           * Content-Type because fetch/FormData
           * automatically generates the multipart boundary.
           */

          const formData = new FormData();

          formData.append(
            "image",
            new Blob([imageBuffer], {
              type:
                baseImage.mediaType ||
                "image/jpeg",
            }),
            "product-image.jpg"
          );

          formData.append(
            "prompt",
            promptText
          );

          /*
           * Hugging Face router.
           *
           * The router handles provider routing.
           */
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

          /*
           * Read response based on status.
           */
          if (!hfRes.ok) {
            const errorText =
              await hfRes.text();

            console.error(
              "Hugging Face HTTP error:",
              hfRes.status,
              errorText
            );

            return {
              success: false,

              error:
                `Hugging Face error (${hfRes.status}): ` +
                errorText.slice(0, 1000),
            };
          }

          /*
           * Hugging Face returns the generated
           * image as binary data.
           */
          const arrayBuffer =
            await hfRes.arrayBuffer();

          const outputBuffer =
            Buffer.from(arrayBuffer);

          if (!outputBuffer.length) {
            return {
              success: false,
              error:
                "Hugging Face mengembalikan gambar kosong.",
            };
          }

          const base64Out =
            outputBuffer.toString("base64");

          const mimeType =
            hfRes.headers.get(
              "content-type"
            ) || "image/png";

          return {
            success: true,
            base64: base64Out,
            mimeType,
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

      /*
       * Generate every selected style.
       */
      for (const style of styles) {
        const promptText =
          styleToPrompt[style] ||
          `Edit this exact product photo according to this style: ${style}. Preserve the original product completely and make the result look like realistic professional commercial product photography.`;

        const result =
          await callHuggingFace(
            promptText
          );

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

    const apiKey =
      process.env.GEMINI_API_KEY;

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
          "Content-Type":
            "application/json",
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

    const data =
      await geminiRes.json();

    if (!geminiRes.ok) {
      console.error(
        "Gemini error:",
        data
      );

      return res.status(502).json({
        error:
          "Gagal memanggil Gemini API.",
        detail: data,
      });
    }

    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]
        ?.text || "";

    const cleaned = rawText
      .replace(
        /```json|```/g,
        ""
      )
      .trim();

    let parsed;

    try {
      parsed =
        JSON.parse(cleaned);
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
    console.error(
      "Server error:",
      err
    );

    return res.status(500).json({
      error:
        "Terjadi kesalahan server.",
      detail: String(err),
    });
  }
}
````
