"use client";

import { useEffect, useState } from "react";

const IMAGES = [
  "/box/e1a274cd553260bb845fe0788729dc5c.jpg",
  "/box/cac85c3efcca29d926a815a292b385de.jpg",
  "/box/d60f4946473ff36377ac8a4d2cb702eb.jpg",
  "/box/2f31e1da533aadedca6daa5c2397e88c.jpg",
  "/box/20c6e7e27341a9a09c00821a99cfb17a.jpg",
  "/box/45f1adc9cd100effacbedb9a8fd9f243.gif",
  "/box/95823fdc258d07bdc469985c56ba9948.gif",
  "/box/129667ec01175be159ece6e8097f4fdc.gif",
];

const FLIP_MS = 140;

export default function RotatingBox() {
  const [i, setI] = useState(0);

  useEffect(() => {
    IMAGES.forEach((src) => {
      const img = new Image();
      img.src = src;
    });

    const id = window.setInterval(() => {
      setI((v) => (v + 1) % IMAGES.length);
    }, FLIP_MS);

    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="hero-box" aria-hidden>
      {IMAGES.map((src, idx) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          className={`hero-box-img${idx === i ? " on" : ""}`}
          decoding="async"
        />
      ))}
    </span>
  );
}
