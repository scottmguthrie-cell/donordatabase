'use client'
import { useState, useCallback, useMemo, useEffect } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { scoreAndGroup, Donor, RawRow, ScoreWeights, GeoFilter, GeoMode, OFFICE_LIST } from '@/lib/scoring'
import { COUNTY_NAMES } from '@/lib/counties'
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
  const [isAdmin, setIsAdmin] = useState(false)
  const [rawRows, setRawRows] = useState<RawRow[]>([])
  const [fileNames, setFileNames] = useState<string[]>([])
  const [donors, setDonors] = useState<Donor[]>([])
  const [selectedDonor, setSelectedDonor] = useState<Donor | null>(null)
  const [weights, setWeights] = useState<ScoreWeights>({ size: 40, recency: 25, freq: 15, office: 20 })
  const [geoMode, setGeoMode] = useState<GeoMode>('county')
  const [selectedCounty, setSelectedCounty] = useState<string>('Montgomery')
  const [officeTarget, setOfficeTarget] = useState<string>('HOUSE')
  const [countySearch, setCountySearch] = useState('')
  const [showCountyDropdown, setShowCountyDropdown] = useState(false)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [sortCol, setSortCol] = useState('donor_score')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [dbSaving, setDbSaving] = useState(false)
  const [dbMsg, setDbMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const [autoLoaded, setAutoLoaded] = useState(false)

  const weightSum = weights.size + weights.recency + weights.freq + weights.office

  const geo: GeoFilter = geoMode === 'county'
    ? { mode: 'county', county: selectedCounty }
    : { mode: geoMode }

  const filteredCounties = COUNTY_NAMES.filter(c =>
    c.toLowerCase().includes(countySearch.toLowerCase())
  )

  // Detect admin mode and auto-load on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const admin = params.get('admin') === 'true'
    setIsAdmin(admin)
    if (!admin) {
      autoLoadAndScore()
    } else {
      setInitialLoading(false)
    }
  }, [])

  const autoLoadAndScore = async () => {
    setInitialLoading(true)
    try {
      // Paginate through all rows (Supabase default limit is 1000)
      let allData: any[] = []
      let from = 0
      const batchSize = 1000
      while (true) {
        const { data: batch, error: batchErr } = await supabase
          .from('raw_donations')
          .select('*')
          .range(from, from + batchSize - 1)
        if (batchErr) throw batchErr
        if (!batch || batch.length === 0) break
        allData = allData.concat(batch)
        if (batch.length < batchSize) break
        from += batchSize
      }
      const data = allData
      if (!data?.length) { setInitialLoading(false); return }
      const mapped: RawRow[] = data.map((r: any) => ({
        FIRST_NAME: r.first_name, LAST_NAME: r.last_name, ADDRESS: r.address,
        CITY: r.city, STATE: r.state, ZIP: r.zip,
        AMOUNT: String(r.amount), RPT_YEAR: String(r.rpt_year),
        FILE_DATE: r.file_date, OFFICE: r.office, PARTY: r.party,
        CANDIDATE_FIRST_NAME: r.candidate_first, CANDIDATE_LAST_NAME: r.candidate_last,
        EMP_OCCUPATION: r.emp_occupation, COM_NAME: r.com_name,
        NON_INDIVIDUAL: r.non_individual,
      }))
      setRawRows(mapped)
      setAutoLoaded(true)
      const w = { size: 40/100, recency: 25/100, freq: 15/100, office: 20/100 }
      const defaultGeo: GeoFilter = { mode: 'county', county: 'Montgomery' }
      const result = scoreAndGroup(mapped, w, defaultGeo, 'HOUSE')
      setDonors(result)
    } catch (e) {
      // silently fail — user will see empty state
    }
    setInitialLoading(false)
  }

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(f => {
      if (!f.name.match(/\.csv$/i)) return
      Papa.parse(f, {
        header: true, skipEmptyLines: true,
        complete: (res) => {
          setRawRows(prev => [...prev, ...(res.data as RawRow[])])
          setFileNames(prev => prev.includes(f.name) ? prev : [...prev, f.name])
        }
      })
    })
  }, [])

  const rescore = useCallback(() => {
    if (weightSum !== 100) return
    setLoading(true)
    setTimeout(() => {
      const w = {
        size: weights.size / 100, recency: weights.recency / 100,
        freq: weights.freq / 100, office: weights.office / 100
      }
      const result = scoreAndGroup(rawRows, w, geo, officeTarget)
      setDonors(result)
      setPage(0)
      setLoading(false)
    }, 50)
  }, [rawRows, weights, geo, officeTarget, weightSum])

  const saveToSupabase = async () => {
    if (!donors.length) return
    setDbSaving(true); setDbMsg('')
    try {
      const donorRows = donors.map(d => ({
        id: d.id, first_name: d.first_name, last_name: d.last_name,
        address: d.address, city: d.city, zip: d.zip,
        total_donated: d.total_donated, num_donations: d.num_donations,
        offices: d.offices, candidates_donated_to: d.candidates_donated_to,
        donor_score: d.donor_score, tier: d.tier,
      }))
      const { error: dErr } = await supabase.from('donors').upsert(donorRows, { onConflict: 'id' })
      if (dErr) throw dErr

      const rawToSave = rawRows
        .filter(r => (r.PARTY || '').trim().toUpperCase() === 'REPUBLICAN' && !(r.NON_INDIVIDUAL || '').trim() && (r.LAST_NAME || '').trim())
        .filter(r => parseFloat((r.AMOUNT || '0').replace(',', '')) >= 250)
      for (let i = 0; i < rawToSave.length; i += 500) {
        const chunk = rawToSave.slice(i, i + 500).map((r, idx) => ({
          id: `${(r.LAST_NAME||'').trim()}_${(r.FIRST_NAME||'').trim()}_${(r.ZIP||'').trim().substring(0,5)}_${i+idx}`,
          first_name: (r.FIRST_NAME||'').trim(), last_name: (r.LAST_NAME||'').trim(),
          address: (r.ADDRESS||'').trim(), city: (r.CITY||'').trim(),
          state: (r.STATE||'').trim(), zip: (r.ZIP||'').trim().substring(0,5),
          amount: parseFloat((r.AMOUNT||'0').replace(',','')||'0'),
          rpt_year: parseInt(r.RPT_YEAR||'0'),
          file_date: (r.FILE_DATE||'').trim(), office: (r.OFFICE||'').trim(),
          party: (r.PARTY||'').trim(),
          candidate_first: (r.CANDIDATE_FIRST_NAME||'').trim(),
          candidate_last: (r.CANDIDATE_LAST_NAME||'').trim(),
          emp_occupation: (r.EMP_OCCUPATION||'').trim(),
          com_name: (r.COM_NAME||'').trim(),
          non_individual: (r.NON_INDIVIDUAL||'').trim(),
        }))
        const { error } = await supabase.from('raw_donations').upsert(chunk, { onConflict: 'id' })
        if (error) throw error
      }

      const donationRows = donors.flatMap(d =>
        d.donations.map((don, i) => ({
          id: `${d.id}_${i}`, donor_id: d.id, seq: i,
          amount: don.amount, rpt_year: don.rpt_year, file_date: don.file_date,
          office: don.office, candidate_first: don.candidate_first,
          candidate_last: don.candidate_last, com_name: don.com_name,
          emp_occupation: don.emp_occupation, report_description: don.report_description,
        }))
      )
      for (let i = 0; i < donationRows.length; i += 500) {
        const { error } = await supabase.from('donations').upsert(donationRows.slice(i, i + 500), { onConflict: 'id' })
        if (error) throw error
      }
      setDbMsg(`✓ Saved ${donors.length} donors and ${rawToSave.length} raw rows`)
    } catch (e: any) { setDbMsg(`Error: ${e.message}`) }
    setDbSaving(false)
  }

  const adminLoadAndRescore = async () => {
    setLoading(true); setDbMsg('')
    try {
      // Paginate through all rows (Supabase default limit is 1000)
      let allData: any[] = []
      let from = 0
      const batchSize = 1000
      while (true) {
        const { data: batch, error: batchErr } = await supabase
          .from('raw_donations')
          .select('*')
          .range(from, from + batchSize - 1)
        if (batchErr) throw batchErr
        if (!batch || batch.length === 0) break
        allData = allData.concat(batch)
        if (batch.length < batchSize) break
        from += batchSize
      }
      const data = allData
      if (!data?.length) { setDbMsg('No raw data in database yet. Upload CSVs first.'); setLoading(false); return }
      const mapped: RawRow[] = data.map((r: any) => ({
        FIRST_NAME: r.first_name, LAST_NAME: r.last_name, ADDRESS: r.address,
        CITY: r.city, STATE: r.state, ZIP: r.zip,
        AMOUNT: String(r.amount), RPT_YEAR: String(r.rpt_year),
        FILE_DATE: r.file_date, OFFICE: r.office, PARTY: r.party,
        CANDIDATE_FIRST_NAME: r.candidate_first, CANDIDATE_LAST_NAME: r.candidate_last,
        EMP_OCCUPATION: r.emp_occupation, COM_NAME: r.com_name,
        NON_INDIVIDUAL: r.non_individual,
      }))
      setRawRows(mapped)
      setFileNames(['(loaded from database)'])
      const w = { size: weights.size/100, recency: weights.recency/100, freq: weights.freq/100, office: weights.office/100 }
      const result = scoreAndGroup(mapped, w, geo, officeTarget)
      setDonors(result)
      setPage(0)
      setDbMsg(`✓ Loaded ${mapped.length} rows — ${result.length} donors scored`)
    } catch (e: any) { setDbMsg(`Error: ${e.message}`) }
    setLoading(false)
  }

  const exportCsv = () => {
    const cols = ['rank','donor_score','tier','first_name','last_name','address','city','zip','total_donated','num_donations','offices','candidates_donated_to']
    const rows = [cols.join(','), ...visible.map(r => cols.map(c => JSON.stringify((r as any)[c] ?? '')).join(','))]
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'gop_donors_scored.csv'; a.click()
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
  const tierA = donors.filter(d => d.tier === 'A').length
  const totalGiven = donors.reduce((s, d) => s + d.total_donated, 0)

  const SortIcon = ({ col }: { col: string }) =>
    sortCol !== col ? <ChevronUp size={12} className="text-gray-300" /> :
    sortDir === -1 ? <ChevronDown size={12} className="text-gray-600" /> : <ChevronUp size={12} className="text-gray-600" />

  if (initialLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <RefreshCw size={24} className="animate-spin text-blue-500" />
        <p className="text-sm text-gray-500">Loading donor data…</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {selectedDonor && <DonorPanel donor={selectedDonor} onClose={() => setSelectedDonor(null)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">GOP Donor Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Ohio Republican donor prospecting · 2021–2026</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={adminLoadAndRescore} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700">
              <Database size={14} /> Load from DB
            </button>
            <button onClick={saveToSupabase} disabled={!donors.length || dbSaving} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
              <Database size={14} /> {dbSaving ? 'Saving…' : 'Save to DB'}
            </button>
          </div>
        )}
      </div>

      {isAdmin && dbMsg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${dbMsg.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {dbMsg}
        </div>
      )}

      {/* Admin-only upload */}
      {isAdmin && (
        <>
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center mb-4 cursor-pointer transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
            onClick={() => document.getElementById('fileInput')?.click()}
          >
            <Upload className="mx-auto mb-2 text-gray-400" size={24} />
            <p className="text-sm font-medium text-gray-700">Drop CSV files here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Ohio SOS CAC_CON_YYYY.CSV</p>
            <input id="fileInput" type="file" multiple accept=".csv,.CSV" className="hidden" onChange={e => handleFiles(e.target.files)} />
          </div>
          {fileNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {fileNames.map(n => (
                <span key={n} className="flex items-center gap-1.5 text-xs bg-white border border-gray-200 rounded-full px-3 py-1">
                  {n}
                  {n !== '(loaded from database)' && (
                    <button onClick={() => setFileNames(prev => prev.filter(x => x !== n))} className="text-gray-400 hover:text-gray-600"><X size={12} /></button>
                  )}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Controls */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Scoring weights</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-4">
          {([['size','Donation size'],['recency','Recency'],['freq','Frequency'],['office','Office proximity']] as [keyof ScoreWeights, string][]).map(([key, label]) => (
            <div key={key}>
              <div className="flex justify-between mb-1">
                <label className="text-xs text-gray-500">{label}</label>
                <span className="text-xs font-medium text-gray-700">{weights[key]}%</span>
              </div>
              <input type="range" min={0} max={100} step={1} value={weights[key]}
                onChange={e => setWeights(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                className="w-full accent-blue-600" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mb-5 text-sm">
          <span className="text-gray-500">Weights sum:</span>
          <span className={`font-medium ${weightSum === 100 ? 'text-green-600' : 'text-red-500'}`}>{weightSum}%</span>
          {weightSum !== 100 && <span className="text-red-500 text-xs">must equal 100%</span>}
        </div>

        <div className="grid grid-cols-2 gap-6 mb-5">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Geography</p>
            <div className="flex gap-2 mb-3">
              {([['county','By county'],['statewide','Statewide OH'],['all','All states']] as [GeoMode,string][]).map(([v,l]) => (
                <button key={v} onClick={() => setGeoMode(v)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${geoMode===v ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {l}
                </button>
              ))}
            </div>
            {geoMode === 'county' && (
              <div className="relative">
                <input
                  type="text"
                  value={countySearch || selectedCounty}
                  onChange={e => { setCountySearch(e.target.value); setShowCountyDropdown(true) }}
                  onFocus={() => { setCountySearch(''); setShowCountyDropdown(true) }}
                  onBlur={() => setTimeout(() => setShowCountyDropdown(false), 150)}
                  placeholder="Search county…"
                  className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
                {showCountyDropdown && (
                  <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {filteredCounties.map(c => (
                      <button key={c} onMouseDown={() => { setSelectedCounty(c); setCountySearch(''); setShowCountyDropdown(false) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${selectedCounty===c ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'}`}>
                        {c} County
                      </button>
                    ))}
                    {filteredCounties.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No counties found</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Office target</p>
            <select value={officeTarget} onChange={e => setOfficeTarget(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white text-gray-700">
              {OFFICE_LIST.map(o => (
                <option key={o} value={o}>{o.charAt(0) + o.slice(1).toLowerCase()}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1.5">Donors who gave to this office type score higher.</p>
          </div>
        </div>

        <button onClick={rescore} disabled={loading || weightSum !== 100 || !rawRows.length}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Scoring…' : 'Rescore donors'}
        </button>
      </div>

      {/* Metrics */}
      {donors.length > 0 && (
        <div className="grid grid-cols-5 gap-3 mb-5">
          {[['Total donors', donors.length.toLocaleString()],['Total donated','$'+Math.round(totalGiven).toLocaleString()],
            ['Avg gift', donors.length ? '$'+Math.round(totalGiven/donors.length).toLocaleString() : '—'],
            ['Tier A donors', tierA.toString()],['Rows loaded', rawRows.length.toLocaleString()]
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
          <input type="text" placeholder="Search name, city, ZIP…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg w-52 focus:outline-none focus:border-blue-400" />
          <select value={tierFilter} onChange={e => { setTierFilter(e.target.value); setPage(0) }}
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none bg-white">
            <option value="">All tiers</option>
            {['A','B','C','D','E'].map(t => <option key={t} value={t}>Tier {t}</option>)}
          </select>
          <div className="ml-auto">
            <button onClick={exportCsv} disabled={!visible.length}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {[['rank','#'],['donor_score','Score'],['tier','Tier'],['last_name','Name'],['city','City'],['zip','ZIP'],['total_donated','Total $'],['num_donations','Gifts'],['offices','Offices']].map(([col,label]) => (
                  <th key={col} onClick={() => handleSort(col)}
                    className="text-left px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">{label}<SortIcon col={col} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSlice.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-16 text-gray-400 text-sm">
                  {initialLoading ? 'Loading…' : donors.length ? 'No donors match filters' : 'No data available'}
                </td></tr>
              ) : pageSlice.map(d => (
                <tr key={d.id} onClick={() => setSelectedDonor(d)}
                  className="border-b border-gray-50 hover:bg-blue-50 cursor-pointer transition-colors">
                  <td className="px-4 py-3 text-gray-400">{(d as any).rank}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.round(d.donor_score * 0.5)}px` }} />
                      <span className="font-medium text-gray-800">{d.donor_score}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIER_COLORS[d.tier]}`}>{d.tier}</span></td>
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
            <p className="text-xs text-gray-500">{page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,visible.length)} of {visible.length}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0,p-1))} disabled={page===0} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
