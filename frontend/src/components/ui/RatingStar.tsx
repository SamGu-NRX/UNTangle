"use client";

export function ratingTier(rating: number | null | undefined): "good" | "ok" | "low" {
  if (rating == null) return "low";
  if (rating >= 4) return "good";
  if (rating >= 3) return "ok";
  return "low";
}

export function RatingStar({
  rating,
  showEmpty = false,
}: {
  rating: number | null | undefined;
  showEmpty?: boolean;
}) {
  if (rating == null) {
    return showEmpty ? (
      <span className="rating-star" data-tier="low">
        <span className="rating-star__icon" aria-hidden="true">
          ☆
        </span>
        <span>—</span>
      </span>
    ) : null;
  }
  const tier = ratingTier(rating);
  return (
    <span className="rating-star" data-tier={tier} aria-label={`Rating ${rating.toFixed(1)} of 5`}>
      <span className="rating-star__icon" aria-hidden="true">
        ★
      </span>
      <span>{rating.toFixed(1)}</span>
    </span>
  );
}
