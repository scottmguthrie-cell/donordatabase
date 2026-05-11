'use client'
import { Donor } from '@/lib/scoring'
import { X, DollarSign, Calendar, Building2, User } from 'lucide-react'

const TIER_COLORS: Record<string, string> = {
  A: 'bg-blue-100 text-blue-800',
  B: 'bg-green-100 text-green-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-gray-100 text-gray-700',
}

export default function DonorPanel({ donor, onClose }: { donor: Donor; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative w-full max-w-lg bg-white shadow-2xl h-full overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIER_COLORS[donor.tier]}`}>
                Tier {donor.tier}
              </span>
              <span className="text-xs text-gray-500">Score: {donor.donor_score}/100</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">
              {donor.first_name} {donor.last_name}
            </h2>
            <p className="text-sm text-gray-500">{donor.address}, {donor.city}, OH {donor.zip}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 px-6 py-4 bg-gray-50 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Total donated</p>
            <p className="text-base font-semibold text-gray-900">${donor.total_donated.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Donations</p>
            <p className="text-base font-semibold text-gray-900">{donor.num_donations}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Avg gift</p>
            <p className="text-base font-semibold text-gray-900">
              ${Math.round(donor.total_donated / donor.num_donations).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Offices + Candidates summary */}
        <div className="px-6 py-4 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Offices supported</p>
          <div className="flex flex-wrap gap-1.5">
            {donor.offices.split(';').map(o => o.trim()).filter(Boolean).map(o => (
              <span key={o} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-md">{o}</span>
            ))}
          </div>
        </div>

        {/* Donation history */}
        <div className="px-6 py-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Donation history</p>
          <div className="space-y-3">
            {donor.donations.map((d, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <DollarSign size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <span className="font-semibold text-gray-900">${d.amount.toLocaleString()}</span>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{d.rpt_year}</span>
                </div>

                <div className="space-y-1.5 text-sm">
                  <div className="flex items-start gap-2">
                    <User size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">
                      <span className="font-medium">{d.candidate_first} {d.candidate_last}</span>
                      {d.office && <span className="text-gray-400"> · {d.office}</span>}
                    </span>
                  </div>

                  {d.com_name && (
                    <div className="flex items-start gap-2">
                      <Building2 size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-500 text-xs">{d.com_name}</span>
                    </div>
                  )}

                  {d.file_date && (
                    <div className="flex items-start gap-2">
                      <Calendar size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-500 text-xs">{d.file_date}</span>
                    </div>
                  )}

                  {d.emp_occupation && (
                    <p className="text-xs text-gray-400 mt-1 pl-5">{d.emp_occupation}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
