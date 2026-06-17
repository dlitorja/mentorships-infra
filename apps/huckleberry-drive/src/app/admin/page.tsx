"use client";

import React from "react";
import Link from "next/link";
import { DollarSign } from "lucide-react";

export default function AdminPage(): React.ReactElement {
  const adminLinks = [
    {
      href: "/admin/costs",
      label: "Storage Costs",
      description: "View monthly storage costs and usage breakdown",
      icon: <DollarSign className="w-6 h-6" />,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-100">Admin Panel</h1>
        <p className="text-slate-400 mt-1">Manage Huckleberry Drive settings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group p-6 bg-slate-800/30 border border-slate-700 rounded-xl hover:border-slate-600 hover:bg-slate-800/50 transition-all"
          >
            <div
              className={`w-12 h-12 ${link.bgColor} rounded-lg ${link.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
            >
              {link.icon}
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-1">
              {link.label}
            </h3>
            <p className="text-sm text-slate-400">{link.description}</p>
          </Link>
        ))}
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Quick Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-2xl font-bold text-emerald-400">-</p>
            <p className="text-sm text-slate-400">Total Instructors</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-400">-</p>
            <p className="text-sm text-slate-400">Total Files</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-400">-</p>
            <p className="text-sm text-slate-400">Storage Used</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-400">-</p>
            <p className="text-sm text-slate-400">Monthly Cost</p>
          </div>
        </div>
      </div>
    </div>
  );
}