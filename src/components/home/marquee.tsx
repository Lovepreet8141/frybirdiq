const WORDS = ["Born crispy", "Built bold", "Fried when you order", "Sector 9, Ambala City", "Pick-up or delivery"];

export function Marquee() {
  const group = (key: string, hidden: boolean) => (
    <div aria-hidden={hidden ? "true" : undefined} className="fb-marquee__group" key={key}>
      {WORDS.map((word) => (
        <span key={word}>
          {word}
          <i aria-hidden="true" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="fb-marquee" role="presentation">
      <div className="fb-marquee__track">
        {group("a", false)}
        {group("b", true)}
      </div>
    </div>
  );
}
