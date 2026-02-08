import { DateRange } from "react-day-picker";

/**
 * Get the date range for the current week (Sunday to Saturday)
 */
export function getCurrentWeekRange(): DateRange {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Calculate Sunday (start of week)
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - dayOfWeek);
    sunday.setHours(0, 0, 0, 0);

    // Calculate Saturday (end of week)
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    saturday.setHours(23, 59, 59, 999);

    return {
        from: sunday,
        to: saturday,
    };
}
