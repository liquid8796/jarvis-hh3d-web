"use client";

import React, { createContext, useContext, useEffect, useState, useTransition } from "react";
import { TRANSLATIONS, type SupportedLanguage, type LandingTranslations } from "./translations";

interface LanguageContextType {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: LandingTranslations;
}

const LanguageContext = createContext<LanguageContextType>({
  language: "en",
  setLanguage: () => {},
  t: TRANSLATIONS.en,
});

const STORAGE_KEY = "hh3d_language";
const COOKIE_NAME = "app_lang";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Mặc định luôn là 'en' theo yêu cầu người dùng
  const [language, setLanguageState] = useState<SupportedLanguage>("en");
  const [, startTransition] = useTransition();

  useEffect(() => {
    // 1. Kiểm tra localStorage hoặc cookie
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
      if (stored === "vi" || stored === "en") {
        setLanguageState(stored);
        document.documentElement.lang = stored;
        return;
      }

      const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
      if (match && (match[1] === "vi" || match[1] === "en")) {
        const cLang = match[1] as SupportedLanguage;
        setLanguageState(cLang);
        document.documentElement.lang = cLang;
        return;
      }
    } catch {
      // Bỏ qua lỗi truy cập storage
    }

    // Mặc định là en
    document.documentElement.lang = "en";
  }, []);

  const setLanguage = (lang: SupportedLanguage) => {
    startTransition(() => {
      setLanguageState(lang);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
        document.cookie = `${COOKIE_NAME}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
        document.documentElement.lang = lang;
      } catch {
        // Bỏ qua
      }
    });
  };

  const t = TRANSLATIONS[language] || TRANSLATIONS.en;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
