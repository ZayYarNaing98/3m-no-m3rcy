import heroImage from '../assets/uno-nomercy.jpeg';

export function HeroBanner() {
  return (
    <>
      <h1 className="sr-only">UNO No Mercy</h1>
      <img
        src={heroImage}
        alt="UNO Show 'Em No Mercy cards flying out of the deck"
        width={597}
        height={335}
        className="w-full rounded-3xl shadow-2xl shadow-red-950/60 ring-1 ring-white/10"
      />
    </>
  );
}
