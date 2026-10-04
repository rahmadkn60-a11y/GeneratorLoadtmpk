export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // GET /
    // =========================
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Auto Uploader Worker is online.", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8"
        }
      });
    }

    // =========================
    // CORS PREFLIGHT
    // =========================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // =========================
    // UPLOAD API
    // =========================
    if (request.method === "POST" && url.pathname === "/api/upload") {
      return handleUpload(request, env);
    }

    // =========================
    // 404
    // =========================
    return new Response(
      JSON.stringify({
        success: false,
        error: "Not Found"
      }),
      {
        status: 404,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json; charset=UTF-8"
        }
      }
    );
  }
};


// ==================================================
// HANDLE UPLOAD
// ==================================================

async function handleUpload(request, env) {
  try {
    if (!env.GITHUB_TOKEN) {
      return jsonResponse(
        {
          success: false,
          error: "GITHUB_TOKEN belum dikonfigurasi di Cloudflare."
        },
        500
      );
    }

    const OWNER = "rahmadkn60-a11y";
    const REPOSITORY = "BUATSCRIPT";
    const TOKEN = env.GITHUB_TOKEN;

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "Request body bukan JSON yang valid."
        },
        400
      );
    }

    const code = typeof body.code === "string"
      ? body.code
      : "";

    if (!code.trim()) {
      return jsonResponse(
        {
          success: false,
          error: "Kode Lua kosong."
        },
        400
      );
    }

    // Maksimum 2 MiB
    const codeSize = new TextEncoder().encode(code).length;

    if (codeSize > 2 * 1024 * 1024) {
      return jsonResponse(
        {
          success: false,
          error: "Ukuran kode terlalu besar. Maksimum 2 MiB."
        },
        413
      );
    }

    // Cari nama file random yang belum digunakan
    const filename = await generateAvailableFilename(
      OWNER,
      REPOSITORY,
      TOKEN
    );

    // Encode Lua menjadi Base64
    const encodedContent = base64EncodeUtf8(code);

    // Upload ke GitHub
    const githubUrl =
      `https://api.github.com/repos/${OWNER}/${REPOSITORY}/contents/${filename}`;

    const uploadResponse = await fetch(githubUrl, {
      method: "PUT",

      headers: {
        "Authorization": `Bearer ${TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "Auto-Uploader-Worker"
      },

      body: JSON.stringify({
        message: `Upload ${filename}`,
        content: encodedContent
      })
    });

    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "GitHub gagal menerima upload.",
          github_status: uploadResponse.status,
          github_message: uploadData?.message || "Unknown GitHub error"
        },
        502
      );
    }

    // Gunakan download_url dari GitHub jika tersedia
    const rawUrl =
      uploadData?.content?.download_url ||
      `https://raw.githubusercontent.com/${OWNER}/${REPOSITORY}/HEAD/${filename}`;

    const loadstring =
      `loadstring(game:HttpGet("${rawUrl}"))()`;

    return jsonResponse({
      success: true,
      filename,
      repository: `${OWNER}/${REPOSITORY}`,
      rawUrl,
      loadstring
    });

  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error?.message || "Terjadi kesalahan pada Worker."
      },
      500
    );
  }
}


// ==================================================
// GENERATE RANDOM AVAILABLE FILENAME
// ==================================================

async function generateAvailableFilename(owner, repository, token) {
  const MAX_ATTEMPTS = 20;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const filename = `${randomString(12)}.lua`;

    const checkUrl =
      `https://api.github.com/repos/${owner}/${repository}/contents/${filename}`;

    const response = await fetch(checkUrl, {
      method: "GET",

      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Auto-Uploader-Worker"
      }
    });

    // File belum ada
    if (response.status === 404) {
      return filename;
    }

    // File sudah ada, generate ulang
    if (response.ok) {
      continue;
    }

    let errorData = {};

    try {
      errorData = await response.json();
    } catch {}

    throw new Error(
      errorData?.message ||
      `Gagal mengecek file GitHub. HTTP ${response.status}`
    );
  }

  throw new Error(
    "Gagal mendapatkan nama file random yang tersedia."
  );
}


// ==================================================
// RANDOM STRING
// ==================================================

function randomString(length) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  const randomValues = new Uint32Array(length);

  crypto.getRandomValues(randomValues);

  let result = "";

  for (let i = 0; i < length; i++) {
    result += alphabet[randomValues[i] % alphabet.length];
  }

  return result;
}


// ==================================================
// UTF-8 → BASE64
// ==================================================

function base64EncodeUtf8(text) {
  const bytes = new TextEncoder().encode(text);

  let binary = "";

  const CHUNK_SIZE = 0x8000;

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + CHUNK_SIZE, bytes.length)
    );

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}


// ==================================================
// JSON RESPONSE
// ==================================================

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json; charset=UTF-8"
      }
    }
  );
}


// ==================================================
// CORS
// ==================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
