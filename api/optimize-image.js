// api/optimize-image.js
// Vercel Serverless Function — Optimalkan Foto Produk dengan Gemini Image

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY belum diset di environment variable Vercel.",
    });
  }
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({
        error: "Foto produk wajib diupload.",
      });
    }
    const prompt = `
Optimalkan foto produk ini untuk digunakan sebagai foto marketplace Indonesia.
ATURAN PENTING:
- Pertahankan produk asli dan identitas produk.
- Jangan mengubah bentuk, desain, logo, tulisan pada produk, atau detail penting produk.
- Jangan membuat produk baru.
- Jangan menambahkan produk lain.
- Perbaiki kualitas foto agar terlihat profesional.
- Tingkatkan pencahayaan, ketajaman, detail, dan warna secara natural.
- Bersihkan noise dan blur jika memungkinkan.
- Buat background putih atau sangat bersih dan profesional.
- Produk harus menjadi fokus utama.
- Rapikan komposisi dan posisi produk.
- Berikan bayangan lembut/natural jika membuat produk terlihat lebih realistis.
- Jangan membuat hasil terlihat seperti gambar AI.
- Jangan menambahkan teks promosi, harga, watermark, badge, atau dekorasi.
- Hasil akhir harus terlihat seperti foto produk marketplace profesional.
Keluarkan gambar hasil optimasi.
`;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType || "image/jpeg",
                    data: image,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
          ],
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini image error:", data);
      return res.status(502).json({
        error: "Gagal memproses foto dengan Gemini.",
        detail: data,
      });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(
      (part) => part?.inlineData?.data || part?.inline_data?.data
    );
    if (!imagePart) {
      console.error("Gemini tidak mengembalikan gambar:", data);
      return res.status(502).json({
        error: "Gemini tidak mengembalikan gambar hasil optimasi.",
        detail: data,
      });
    }
    const resultImage =
      imagePart?.inlineData?.data || imagePart?.inline_data?.data;
    const resultMimeType =
      imagePart?.inlineData?.mimeType ||
      imagePart?.inline_data?.mime_type ||
      "image/png";
    return res.status(200).json({
      success: true,
      image: resultImage,
      mimeType: resultMimeType,
    });
  } catch (err) {
    console.error("Optimize image error:", err);
    return res.status(500).json({
      error: "Terjadi kesalahan server.",
      detail: String(err),
    });
  }
}
