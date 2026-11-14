export function redactCallText(text: string) {
    return text.replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
        .replace(/^(\s*(?:authorization|cookie|set-cookie)\s*:\s*).*$/gim, "$1[REDACTED]")
        .replace(/(["'](?:access_token|refresh_token|id_token|authorization|cookie|api[_-]?key)["']\s*:\s*")[^"\r\n]*(")/gi, "$1[REDACTED]$2")
        .replace(/((?:access_token|refresh_token|id_token|authorization|cookie|api[_-]?key)\s*["']?\s*[:=]\s*["']?)[^\s"',}\n]+/gi, "$1[REDACTED]");
}
