/**
 * Telegram Bot API — Stateless message/photo/document sender.
 * All functions accept botToken per-request (no env config needed).
 */

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Send a text message to a Telegram chat.
 */
export async function sendMessage(
    botToken: string,
    chatId: string,
    text: string,
    parseMode: string = "Markdown"
) {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: parseMode,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram sendMessage failed: ${res.status} - ${err}`);
    }
    return await res.json();
}

/**
 * Send a photo (base64 PNG) to a Telegram chat via multipart/form-data.
 */
export async function sendPhoto(
    botToken: string,
    chatId: string,
    photoBase64: string,
    caption?: string,
    parseMode: string = "Markdown"
) {
    const photoBuffer = Buffer.from(photoBase64, "base64");

    const formData = new FormData();
    formData.append("chat_id", chatId);
    if (caption) {
        formData.append("caption", caption);
        formData.append("parse_mode", parseMode);
    }
    const blob = new Blob([photoBuffer], { type: "image/png" });
    formData.append("photo", blob, "chart.png");

    const url = `${TELEGRAM_API}/bot${botToken}/sendPhoto`;
    const res = await fetch(url, {
        method: "POST",
        body: formData,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram sendPhoto failed: ${res.status} - ${err}`);
    }
    return await res.json();
}

/**
 * Send a document (base64 file) to a Telegram chat via multipart/form-data.
 */
export async function sendDocument(
    botToken: string,
    chatId: string,
    documentBase64: string,
    filename: string,
    caption?: string,
    parseMode: string = "Markdown"
) {
    const docBuffer = Buffer.from(documentBase64, "base64");

    const formData = new FormData();
    formData.append("chat_id", chatId);
    if (caption) {
        formData.append("caption", caption);
        formData.append("parse_mode", parseMode);
    }
    const blob = new Blob([docBuffer]);
    formData.append("document", blob, filename);

    const url = `${TELEGRAM_API}/bot${botToken}/sendDocument`;
    const res = await fetch(url, {
        method: "POST",
        body: formData,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram sendDocument failed: ${res.status} - ${err}`);
    }
    return await res.json();
}
