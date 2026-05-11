'use client'
import { useState, useCallback, useMemo } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { scoreAndGroup, Donor, RawRow, ScoreWeights, GeoFilter, OfficeTarget } from '@/lib/scoring'
import DonorPanel from './DonorPanel'
import { Upload, RefreshCw, Download, ChevronUp, ChevronDown, X, Database } from 'lucide-react'

const TIER_COLORS: Record<string, string> = {
  A: 'bg-blue-100 text-blue-800',
  B: 'bg-green-100 text-green-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-gray-100 text-gray-700',
}

const PAGE_SIZE = 25

export default function Dashboard() {
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [fileNames, setFileNames] = useState<string[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null)
  const [weights, setWeights] = useState<ScoreWeights>({ size: 40, recency: 25, freq: 15, office: 20 })
  const [geo, setGeo] = useState<GeoFilter>('montgomery')
  const [officeTarget, setOfficeTarget] = useState<OfficeTarget>('county')
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [sortCol, setSortCol] = useState('donor_score')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [dbSaving, setDbSaving] = useState(false)
  const [dbMsg, setDbMsg] = useState('')
  const [dragging, setDragging] = useState(false)

  const weightSum = weights.size + weights.recency + weights.freq + weights.office

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(f => {
      if (!f.name.match(/\.csv$/i)) return
      Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          setRawRows(prev => [...prev, ...(res.data as RawRow[])])
          setFileNames(prev => prev.includes(f.name) ? prev : [...prev, f.name])
        }
      })
    })
  }, [])

  const removeFile = (name: string) => {
    setFileNames(prev => prev.filter(n => n !== name))
  }

  const rescore = useCallback(() => {
    if (weightSum !== 100) return
    setLoading(true)
    setTimeout(() => {
      const w = { size: weights.size / 100, recency: weights.recency / 100, freq: weights.freq / 100, office: weights.office / 100 }
      const result = scoreAndGroup(rawRows, w, geo, officeTarget)
      setDonors(result)
      setPage(0)
      setLoading(false)
    }, 50)
  }, [rawRows, weights, geo, officeTarget, weightSum])

  const saveToSupabase = async () => {
    if (!donors.length) return
    setDbSaving(true)
    setDbMsg('')
    try {
      // Save donors
      const donorRows = donors.map(d => ({
        id: d.id,
        first_name: d.first_name,
        last_name: d.last_name,
        address: d.address,
        city: d.city,
        zip: d.zip,
        total_donated: d.total_donated,
        num_donations: d.num_donations,
        offices: d.offices,
        candidates_donated_to: d.candidates_donated_to,
        donor_score: d.donor_score,
        tier: d.tier,
      }))
      const { error: dErr } = await supabase.from('donors').upsert(donorRows, { onConflict: 'id' })
      if (dErr) throw dErr

      // Save donations
      const donationRows = donors.flatMap(d =>
        d.donations.map((don, i) => ({
          donor_id: d.id,
          seq: i,
          amount: don.amount,
          rpt_year: don.rpt_year,
          file_date: don.file_date,
          office: don.office,
          candidate_first: don.candidate_first,
          candidate_last: don.candidate_last,
          com_name: don.com_name,
          emp_occupation: don.emp_occupation,
          report_description: don.report_description,
        }))
      )
      // Batch in chunks of 500
      for (let i = 0; i < donationRows.length; i += 500) {
        const chunk = donationRows.slice(i, i + 500)
        const { error: donErr } = await supabase.from('donations').upsert(
          chunk.map(r => ({ ...r, id: `${r.donor_id}_${r.seq}` })),
          { onConflict: 'id' }
        )
        if (donErr) throw donErr
      }
      setDbMsg(`✓ Saved ${donors.length} donors and ${donationRows.length} donations`)
    } catch (e: any) {
      setDbMsg(`Error: ${e.message}`)
    }
    setDbSaving(false)
  }

  const loadFromSupabase = async () => {
    setLoading(true)
    setDbMsg('')
    try {
      const { data: donorData, error: dErr } = await supabase
        .from('donors')
        .select('*')
        .order('donor_score', { ascending: false })
      if (dErr) throw dErr

      const { data: donData, error: donErr } = await supabase
        .from('donations')
        .select('*')
      if (donErr) throw donErr

      const donByDonor: Record<string, any[]> = {}
      donData?.forEach(d => {
        if (!donByDonor[d.donor_id]) donByDonor[d.donor_id] = []
        donByDonor[d.donor_id].push(d)
      })

      const loaded: Donor[] = (donorData || []).map((d, i) => ({
        ...d,
        rank: i + 1,
        donations: (donByDonor[d.id] || []).sort((a, b) => b.rpt_year - a.rpt_year),
      }))
      setDonors(loaded)
      setDbMsg(`✓ Loaded ${loaded.length} donors from database`)
    } catch (e: any) {
      setDbMsg(`Error: ${e.message}`)
    }
    setLoading(false)
  }

  const exportCsv = () => {
    const cols = ['rank','donor_score','tier','first_name','last_name','address','city','zip','total_donated','num_donations','offices','candidates_donated_to']
    const rows = [cols.join(','), ...visible.map(r => cols.map(c => JSON.stringify((r as any)[c] ?? '')).join(','))]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'gop_donors_scored.csv'
    a.click()
  }

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1)
    else { setSortCol(col); setSortDir(-1) }
  }

  const sorted = useMemo(() => {
    return [...donors].sort((a, b) => {
      const av = (a as any)[sortCol], bv = (b as any)[sortCol]
      if (typeof av === 'number') return (av - bv) * sortDir
      return String(av || '').localeCompare(String(bv || '')) * sortDir
    }).map((r, i) => ({ ...r, rank: i + 1 }))
  }, [donors, sortCol, sortDir])

  const visible = useMemo(() => {
    const q = search.toLowerCase()
    return sorted.filter(r => {
      if (tierFilter && r.tier !== tierFilter) return false
      if (q) {
        const hay = `${r.first_name} ${r.last_name} ${r.city} ${r.zip}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sorted, search, tierFilter])

  const pageSlice = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(visible.length / PAGE_SIZE)

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <ChevronUp size={12} className="text-gray-300" />
    return sortDir === -1 ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronUp size={12} className="text-gray-600" />
  }

  const tierA = donors.filter(d => d.tier === 'A').length
  const totalGiven = donors.reduce((s, d) => s + d.total_donated, 0)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {selectedDonor && <DonorPanel donor={selectedDonor} onClose={() => setSelectedDonor(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">GOP Donor Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Ohio Republican donor prospecting · 2021–2026</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadFromSupabase}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            <Database size={14} /> Load saved
          </button>
          <button
            onClick={saveToSupabase}
            disabled={!donors.length || dbSaving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            <Database size={14} /> {dbSaving ? 'Saving…' : 'Save to DB'}
          </button>
        </div>
      </div>

      {dbMsg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${dbMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {dbMsg}
        </div>
      )}

      {/* Upload */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center mb-4 cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => document.getElementById('fileInput')?.click()}
      >
        <Upload className="mx-auto mb-2 text-gray-400" size={24} />
        <p className="text-sm font-medium text-gray-700">Drop CSV files here or click to browse</p>
        <p className="text-xs text-gray-400 mt-1">Ohio SOS CAC_CON_YYYY.CSV format</p>
        <input id="fileInput" type="file" multiple accept=".csv,.CSV" className="hidden" onChange={e => handleFiles(e.target.files)} />
      </div>

      {fileNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {fileNames.map(n => (
            <span key={n} className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 rounded-full px-3 py-1">
              {n}
              <button onClick={() => removeFile(n)} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-5">
          {([
            ['size', 'Donation size'],
            ['recency', 'Recency'],
            ['freq', 'Frequency'],
            ['office', 'Office proximity'],
          ] as [keyof ScoreWeights, string][]).map(([key, label]) => (
            <div key={key}>
              <div className="flex justify-between mb-1">
                <label className="text-xs text-gray-500">{label}</label>
                <span className="text-xs font-medium text-gray-700">{weights[key]}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={1} value={weights[key]}
                onChange={e => setWeights(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mb-4 text-sm">
          <span className="text-gray-500">Weights sum:</span>
          <span className={`font-medium ${weightSum === 100 ? 'text-green-600' : 'text-red-500'}`}>{weightSum}%</span>
          {weightSum !== 100 && <span className="text-red-500 text-xs">must equal 100%</span>}
        </div>

        <div className="grid grid-cols-2 gap-6 mb-4">
          <div>
            <p className="text-xs text-gray-500 mb-2">Geography</p>
            <div className="flex gap-2 flex-wrap">
              {([['montgomery','Montgomery Co.'],['statewide','Statewide OH'],['all','All states']] as [GeoFilter,string][]).map(([v,l]) => (
                <button key={v} onClick={() => setGeo(v)} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${geo===v ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">Office target</p>
            <div className="flex gap-2 flex-wrap">
              {([['county','County commissioner'],['house','State house'],['statewide','Statewide']] as [OfficeTarget,string][]).map(([v,l]) => (
                <button key={v} onClick={() => setOfficeTarget(v)} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${officeTarget===v ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={rescore}
          disabled={loading || weightSum !== 100 || !rawRows.length}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Scoring…' : 'Rescore donors'}
        </button>
      </div>

      {/* Metrics */}
      {donors.length > 0 && (
        <div className="grid grid-cols-5 gap-3 mb-5">
          {[
            ['Total donors', donors.length.toLocaleString()],
            ['Total donated', '$' + Math.round(totalGiven).toLocaleString()],
            ['Avg gift', '$' + (donors.length ? Math.round(totalGiven / donors.length).toLocaleString() : '—')],
            ['Tier A donors', tierA.toString()],
            ['Rows loaded', rawRows.length.toLocaleString()],
          ].map(([label, value]) => (
            <div key={label} className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-xl font-semibold text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100">
          <input
            type="text" placeholder="Search name, city, ZIP…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg w-52 focus:outline-none focus:border-blue-400"
          />
          <select
            value={tierFilter} onChange={e => { setTierFilter(e.target.value); setPage(0) }}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none"
          >
            <option value="">All tiers</option>
            {['A','B','C','D','E'].map(t => <option key={t} value={t}>Tier {t}</option>)}
          </select>
          <div className="ml-auto">
            <button onClick={exportCsv} disabled={!visible.length} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {[['rank','#'],['donor_score','Score'],['tier','Tier'],['last_name','Name'],['city','City'],['zip','ZIP'],['total_donated','Total $'],['num_donations','Gifts'],['offices','Offices']].map(([col, label]) => (
                  <th
                    key={col} onClick={() => handleSort(col)}
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-800 whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">{label}<SortIcon col={col} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSlice.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-gray-400 text-sm">
                  {donors.length ? 'No donors match filters' : 'Upload CSVs and click Rescore, or load from database'}
                </td></tr>
              ) : pageSlice.map(d => (
                <tr
                  key={d.id}
                  onClick={() => setSelectedDonor(d)}
                  className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-gray-400">{(d as any).rank}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.round(d.donor_score * 0.5)}px` }} />
                      <span className="font-medium text-gray-800">{d.donor_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIER_COLORS[d.tier]}`}>
                      {d.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{d.first_name} {d.last_name}</td>
                  <td className="px-4 py-3 text-gray-600">{d.city}</td>
                  <td className="px-4 py-3 text-gray-500">{d.zip}</td>
                  <td className="px-4 py-3 text-gray-800">${d.total_donated.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{d.num_donations}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate">{d.offices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} of {visible.length}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
