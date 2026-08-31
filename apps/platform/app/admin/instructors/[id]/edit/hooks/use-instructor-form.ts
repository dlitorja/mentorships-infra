'use client';

import { useState, useEffect } from "react";
import type { InstructorDetail, InstructorFormData, Socials } from "../types";

const defaultFormData: InstructorFormData = {
  name: "",
  slug: "",
  email: "",
  discordVoiceChannelUrl: "",
  tagline: "",
  bio: "",
  specialties: [],
  background: [],
  profileImageUrl: "",
  profileImageUploadPath: "",
  portfolioImages: [],
  socials: {},
  isActive: true,
  isListed: true,
  userId: null,
  instructorId: null,
  oneOnOneInventory: 0,
  groupInventory: 0,
  maxActiveStudents: 10,
  useKajabiCheckout: false,
  kajabiCheckoutUrlOneOnOne: "",
  kajabiCheckoutUrlGroup: "",
};

export function useInstructorForm(data: InstructorDetail | undefined) {
  const [formData, setFormData] = useState<InstructorFormData>(defaultFormData);
  const [customSpecialty, setCustomSpecialty] = useState("");
  const [customBackground, setCustomBackground] = useState("");
  const [portfolioInput, setPortfolioInput] = useState("");

  useEffect(() => {
    if (data) {
      setFormData({
        name: data.name || "",
        slug: data.slug || "",
        email: data.email || "",
        discordVoiceChannelUrl: data.discordVoiceChannelUrl || "",
        tagline: data.tagline || "",
        bio: data.bio || "",
        specialties: data.specialties || [],
        background: data.background || [],
        profileImageUrl: data.profileImageUrl || "",
        profileImageUploadPath: data.profileImageUploadPath || "",
        portfolioImages: data.portfolioImages || [],
        socials: data.socials && typeof data.socials === "object" && !Array.isArray(data.socials) ? data.socials : {},
        isActive: data.isActive ?? true,
        isListed: data.isListed ?? true,
        userId: data.userId || null,
        instructorId: data.instructorId || null,
        oneOnOneInventory: data.oneOnOneInventory ?? 0,
        groupInventory: data.groupInventory ?? 0,
        maxActiveStudents: data.maxActiveStudents ?? 10,
        useKajabiCheckout: (data as any).useKajabiCheckout ?? false,
        kajabiCheckoutUrlOneOnOne: (data as any).kajabiCheckoutUrlOneOnOne ?? "",
        kajabiCheckoutUrlGroup: (data as any).kajabiCheckoutUrlGroup ?? "",
      });
    }
  }, [data]);

  const toggleTag = (field: "specialties" | "background", value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value],
    }));
  };

  const addCustomTag = (field: "specialties" | "background", value: string, setValue: React.Dispatch<React.SetStateAction<string>>) => {
    if (!value.trim()) return;
    if (!formData[field].includes(value.trim())) {
      setFormData((prev) => ({
        ...prev,
        [field]: [...prev[field], value.trim()],
      }));
    }
    setValue("");
  };

  const addPortfolioImage = () => {
    if (!portfolioInput.trim()) return;
    if (!formData.portfolioImages.includes(portfolioInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        portfolioImages: [...prev.portfolioImages, portfolioInput.trim()],
      }));
    }
    setPortfolioInput("");
  };

  const removePortfolioImage = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      portfolioImages: prev.portfolioImages.filter((_, i) => i !== index),
    }));
  };

  const updateSocial = (key: keyof Socials, value: string) => {
    setFormData((prev) => ({
      ...prev,
      socials: { ...prev.socials, [key]: value || undefined },
    }));
  };

  return {
    formData,
    setFormData,
    customSpecialty,
    setCustomSpecialty,
    customBackground,
    setCustomBackground,
    portfolioInput,
    setPortfolioInput,
    toggleTag,
    addCustomTag,
    addPortfolioImage,
    removePortfolioImage,
    updateSocial,
  };
}
