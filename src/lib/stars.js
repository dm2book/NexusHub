/**
 * How many of five stars to fill — for one review, or for the shop's average.
 *
 * Its own module with no imports, so the server tests can check it. The pages
 * used to draw `r.stars || 5` stars for a review (a missing value became five)
 * and five full stars beside any average, a 3.2 included: the picture said
 * "perfect" whatever the number next to it said.
 */

/** One review's stars, 0–5. Missing is zero filled, never five. */
export const starsOf = (review) => Math.max(0, Math.min(5, Math.round(Number(review?.stars) || 0)));

/** An average such as 4.3, as whole stars to fill: rounded, 0–5. */
export const filledFor = (rating) => Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
