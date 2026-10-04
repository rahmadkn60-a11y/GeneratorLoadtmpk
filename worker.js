export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS / preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // API endpoint
    if (
      url.pathname === "/api/upload" &&
      request.method === "POST"
    ) {
      return handleUpload(request, env);
    }

    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders()
    });
  }
};


async function handleUpload(request, env) {
  try {
    /*
     * Pastikan GitHub token tersedia
     * di Cloudflare Worker Secret.
     */

    if (!env.GITHUB_TOKEN) {
      return json(
        {
          error:
            "GITHUB_TOKEN belum dikonfigurasi di Cloudflare."
        },
        500
      );
    }


    const body = await request.json();

    const code =
      typeof body.code === "string"
        ? body.code
        : "";

    const repo =
      typeof body.repo === "string"
        ? body.repo.trim()
        : "";

    const filename =
      typeof body.filename === "string"
        ? body.filename.trim()
        : "";


    if (!code) {
      return json(
        {
          error:
            "Source code tidak boleh kosong."
        },
        400
      );
    }


    /*
     * Format repository:
     *
     * username/repository
     */

    const repoParts =
      repo.split("/");


    if (
      repoParts.length !== 2 ||
      !repoParts[0] ||
      !repoParts[1]
    ) {
      return json(
        {
          error:
            "Format repository harus username/repository."
        },
        400
      );
    }


    const owner =
      repoParts[0];

    const repository =
      repoParts[1];


    /*
     * Hindari path aneh.
     *
     * Contoh:
     * script.lua
     * folder/script.lua
     */

    const cleanFilename =
      sanitizeFilename(filename);


    if (!cleanFilename) {
      return json(
        {
          error:
            "Nama file tidak valid."
        },
        400
      );
    }


    /*
     * GitHub Contents API
     */

    const githubUrl =
      `https://api.github.com/repos/` +
      `${encodeURIComponent(owner)}/` +
      `${encodeURIComponent(repository)}/` +
      `/contents/${cleanFilename}`;


    /*
     * GitHub membutuhkan Base64.
     */

    const contentBase64 =
      uint8ToBase64(
        new TextEncoder().encode(code)
      );


    /*
     * Cek apakah file sudah ada.
     *
     * Kalau sudah ada, kita membutuhkan SHA
     * agar GitHub bisa melakukan update.
     */

    let existingSha = null;


    const checkResponse =
      await fetch(githubUrl, {
        method: "GET",

        headers: githubHeaders(
          env.GITHUB_TOKEN
        )
      });


    if (checkResponse.ok) {

      const existing =
        await checkResponse.json();

      existingSha =
        existing.sha || null;

    } else if (
      checkResponse.status !== 404
    ) {

      const errorText =
        await checkResponse.text();

      return json(
        {
          error:
            `GitHub check gagal: ${errorText}`
        },
        502
      );
    }


    /*
     * Upload / update file.
     */

    const uploadBody = {
      message:
        existingSha
          ? `Update ${cleanFilename}`
          : `Upload ${cleanFilename}`,

      content:
        contentBase64
    };


    if (existingSha) {
      uploadBody.sha =
        existingSha;
    }


    const uploadResponse =
      await fetch(githubUrl, {
        method: "PUT",

        headers: githubHeaders(
          env.GITHUB_TOKEN
        ),

        body: JSON.stringify(
          uploadBody
        )
      });


    const uploadData =
      await uploadResponse.json();


    if (!uploadResponse.ok) {

      return json(
        {
          error:
            uploadData.message ||
            "GitHub upload gagal."
        },
        uploadResponse.status
      );
    }


    /*
     * Raw GitHub URL.
     *
     * Menggunakan branch yang diberikan
     * GitHub sebagai download_url.
     */

    const rawUrl =
      uploadData.content?.download_url ||
      buildRawUrl(
        owner,
        repository,
        uploadData.content?.path
      );


    if (!rawUrl) {
      return json(
        {
          error:
            "Raw URL tidak berhasil dibuat."
        },
        502
      );
    }


    /*
     * Format hasil akhir.
     */

    const loadstring =
      `loadstring(game:HttpGet("${rawUrl}"))()`;


    return json({
      success: true,

      repository:
        `${owner}/${repository}`,

      filename:
        cleanFilename,

      rawUrl,

      loadstring
    });


  } catch (error) {

    console.error(error);

    return json(
      {
        error:
          error?.message ||
          "Internal server error."
      },
      500
    );
  }
}


/*
 * Header untuk GitHub API.
 */

function githubHeaders(token) {
  return {
    "Authorization":
      `Bearer ${token}`,

    "Accept":
      "application/vnd.github+json",

    "X-GitHub-Api-Version":
      "2022-11-28",

    "User-Agent":
      "Cloudflare-Auto-Uploader",

    "Content-Type":
      "application/json"
  };
}


/*
 * Membuat Raw URL.
 */

function buildRawUrl(
  owner,
  repository,
  path
) {
  if (!path) {
    return null;
  }

  const encodedPath =
    path
      .split("/")
      .map(
        part =>
          encodeURIComponent(part)
      )
      .join("/");

  return (
    `https://raw.githubusercontent.com/` +
    `${encodeURIComponent(owner)}/` +
    `${encodeURIComponent(repository)}/` +
    `HEAD/` +
    encodedPath
  );
}


/*
 * Sanitasi nama file.
 */

function sanitizeFilename(filename) {

  let value =
    filename
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");


  const parts =
    value
      .split("/")
      .filter(Boolean);


  if (!parts.length) {
    return "";
  }


  /*
   * Mencegah path traversal.
   */

  if (
    parts.some(
      part =>
        part === "." ||
        part === ".."
    )
  ) {
    return "";
  }


  return parts.join("/");
}


/*
 * Uint8Array -> Base64
 *
 * Tidak menggunakan btoa()
 * secara langsung supaya aman untuk
 * source code UTF-8.
 */

function uint8ToBase64(bytes) {

  let binary = "";

  const chunkSize =
    0x8000;


  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {

    const chunk =
      bytes.subarray(
        i,
        Math.min(
          i + chunkSize,
          bytes.length
        )
      );

    binary += String.fromCharCode(
      ...chunk
    );
  }


  return btoa(binary);
}


/*
 * JSON response.
 */

function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        ...corsHeaders(),

        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}


/*
 * CORS.
 */

function corsHeaders() {

  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"
  };
}
