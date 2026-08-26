// api/generate.js
// Backend serverless function (Vercel) — menyambungkan ke Gemini API
// Menangani 4 mode: listing, ads, screenshot, foto (semua berbasis teks, 100% gratis)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY belum diset di environment variable Vercel." });
  }

  try {
    const { mode, images, fields } = req.body;
    if (!mode) return res.status(400).json({ error: "Mode wajib diisi." });
    if (!images || images.length === 0) {
      return res.status(400).json({ error: "Minimal upload 1 foto/screenshot." });
    }

    let promptText = "";

    if (mode === "foto") {
      const gaya = fields.gaya || "background putih polos, pencahayaan studio yang bersih dan profesional";
      promptText = `Lihat foto produk yang dilampirkan ini dengan detail (bentuk, warna, tekstur, material, detail unik produknya).
Gaya yang diinginkan untuk hasil akhir: ${gaya}

Buatkan SATU prompt dalam Bahasa Inggris yang sangat detail dan siap pakai, yang nantinya akan di-paste oleh pengguna ke AI image generator (seperti ChatGPT/Gemini) BERSAMA dengan foto produk aslinya, supaya AI itu mengedit foto sesuai gaya yang diminta TANPA mengubah bentuk/desain/detail asli produknya.

Prompt harus mencakup instruksi eksplisit:
- Pertahankan bentuk, warna, logo, tulisan, dan semua detail produk asli
- Deskripsi gaya akhir yang diinginkan (background, pencahayaan, komposisi)
- Larangan menambah produk lain, teks promosi, watermark, atau elemen palsu
- Hasil harus terlihat seperti foto produk marketplace profesional, bukan gambar AI yang terlihat artifisial

Balas HANYA JSON tanpa markdown fence: {"prompt_en":"...", "catatan_singkat":"penjelasan 1 kalimat dalam Bahasa Indonesia tentang apa yang akan dihasilkan prompt ini"}`;
    } else if (mode === "listing") {
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
