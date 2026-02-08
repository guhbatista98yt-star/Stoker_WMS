import { useEffect, useRef } from "react";

// Hook to capture barcode scans globally (simulated by rapid request of keys ending in Enter)
export function useBarcodeScanner(onScan: (barcode: string) => void) {
    const bufferRef = useRef("");
    const lastKeyTimeRef = useRef(0);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in a real input (except our specific barcode input if needed)
            // Check if target is an editable input
            const target = e.target as HTMLElement;
            if (
                (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
                !target.classList.contains("barcode-scanner-input") // Allow our custom class to process if used
            ) {
                return;
            }

            const now = Date.now();

            // Reset buffer if too much time passed between keystrokes (manual typing vs scanner wedge)
            // Scanners are fast (<50-100ms per char). Manual typing is slower.
            // Set to 100ms tolerance.
            if (now - lastKeyTimeRef.current > 100) {
                bufferRef.current = "";
            }
            lastKeyTimeRef.current = now;

            if (e.key === "Enter") {
                if (bufferRef.current.length > 2) { // Min barcode length check
                    onScan(bufferRef.current);
                    bufferRef.current = "";
                    e.preventDefault(); // Prevent accidental form submit
                }
            } else if (e.key.length === 1) {
                // Printable characters only
                bufferRef.current += e.key;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onScan]);
}
