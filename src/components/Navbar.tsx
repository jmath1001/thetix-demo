'use client';
import React, { useState } from 'react';
import { Menu, X, Calendar, Users, GraduationCap } from 'lucide-react';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { name: 'Schedule', icon: Calendar, href: '/' },
    { name: 'Manage Tutors', icon: Users, href: '/tutor' }, // You can trigger your modal here
    { name: 'Students', icon: GraduationCap, href: '/students' },
  ];

  return (
    <nav className="fixed top-0 left-0 w-full z-50 bg-white border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo - Clickable to Home */}
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 bg-[#6d28d9] rounded-lg flex items-center justify-center text-white font-bold">T</div>
          <span className="font-bold text-sm md:text-base text-stone-900">Scheduler</span>
        </a>

        {/* Desktop Links (Hidden on Mobile) */}
        <div className="hidden md:flex items-center gap-6">
          {navItems.map((item) => (
            <a key={item.name} href={item.href} className="text-sm font-medium text-stone-600 hover:text-[#6d28d9]">
              {item.name}
            </a>
          ))}
        </div>

        {/* Hamburger Button (Visible on Mobile only) */}
        <button 
          className="md:hidden p-2 text-stone-600" 
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Drawer Menu */}
      {isOpen && (
        <div className="md:hidden absolute top-16 left-0 w-full bg-white border-b border-stone-200 shadow-xl animate-in fade-in slide-in-from-top-2">
          <div className="flex flex-col p-4 gap-2">
            {navItems.map((item) => (
              <a 
                key={item.name} 
                href={item.href} 
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-stone-50 text-xs font-semibold text-stone-700"
              >
                <item.icon size={16} className="text-[#6d28d9]" />
                {item.name}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}