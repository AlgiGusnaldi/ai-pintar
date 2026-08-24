// api/generate.js
// Backend serverless function (Vercel)
// Mode teks (listing, ads, screenshot) -> Gemini API
// Mode foto (image edit)             -> Gemini Image (gemini-2.5-flash-image)
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY belum diset di environment variable Vercel." });
    }

    // ===== MODE FOTO — Gemini Image (gemini-2.5-flash-image) =====
    if (mode === "foto") {
      if (!styles || styles.length === 0) {
        return res.status(400).json({ error: "Pilih minimal 1 gaya foto." });
      }

      const styleToPrompt = {
        "Background Putih Polos": "ubah background foto produk ini menjadi putih polos bersih, pencahayaan studio merata, produk tetap fokus tajam, hasil seperti foto e-commerce profesional",
        "Enhance Cahaya & Ketajaman": "perbaiki foto produk ini agar lebih terang, tajam, dan jelas, dengan pencahayaan studio profesional, background tetap sama",
        "Background Studio": "ubah background foto produk ini menjadi studio profesional dengan gradasi abu-abu lembut, pencahayaan dramatis ala katalog",
        "Background Lifestyle": "tempatkan produk ini dalam suasana lifestyle yang nyaman dan relevan dengan produknya, pencahayaan natural, produk tetap jadi fokus utama",
        "Tambah Badge Best Seller": "tambahkan badge kecil bertuliskan BEST SELLER berwarna di pojok foto produk ini, produk tidak diubah",
        "Tambah Watermark Brand": "tambahkan watermark teks brand kecil dan halus di pojok bawah foto produk ini, produk tidak diubah",
      };

      const baseImage = images[0]; // pakai foto pertama sebagai sumber
      const results = [];

      for (const style of styles) {
        const promptText = `
Optimalkan foto produk ini untuk digunakan sebagai foto marketplace Indonesia.
ATURAN PENTING:
- Pertahankan produk asli dan identitas produk (bentuk, desain, logo, tulisan pada produk).
- Jangan membuat produk baru atau menambahkan produk lain.
- Jangan membuat hasil terlihat seperti gambar AI.
Instruksi spesifik: ${styleToPrompt[style] || style}
Keluarkan gambar hasil optimasi.
`;

        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        inline_data: {
                          mime_type: baseImage.mediaType || "image/jpeg",
                          data: baseImage.base64,
                        },
                      },
                      { text: promptText },
                    ],
                  },
                ],
                generationConfig: { responseModalities: ["IMAGE"] },
              }),
            }
          );

          const data = await geminiRes.json();

          if (!geminiRes.ok) {
            console.error("Gemini image error:", data);
            results.push({ style, error: "Gagal memproses foto dengan Gemini." });
            continue;
          }

          const parts = data?.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find(
            (part) => part?.inlineData?.data || part?.inline_data?.data
          );

          if (!imagePart) {
            console.error("Gemini tidak mengembalikan gambar:", data);
            results.push({ style, error: "Gemini tidak mengembalikan gambar hasil optimasi." });
            continue;
          }

          const resultImage = imagePart?.inlineData?.data || imagePart?.inline_data?.data;
          const resultMimeType =
            imagePart?.inlineData?.mimeType || imagePart?.inline_data?.mime_type || "image/png";

          results.push({ style, mimeType: resultMimeType, base64: resultImage });
        } catch (innerErr) {
          console.error("Gemini fetch error:", innerErr);
          results.push({ style, error: "Terjadi kesalahan saat memanggil Gemini." });
        }
      }

      return res.status(200).json({ result: { images: results } });
    }

    // ===== MODE TEKS (listing, ads, screenshot) — Gemini API =====
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
