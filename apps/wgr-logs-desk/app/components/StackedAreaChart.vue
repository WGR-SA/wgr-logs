<script setup lang="ts">
interface Point { time: number; value: number }
interface Series { name: string; points: Point[] }

interface Props {
  series: Series[]
  height?: number
  // Limit to top N series, group rest as "other"
  topN?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 220,
  topN: 8
})

const PALETTE = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#22d3ee', '#facc15', '#94a3b8']

const hovered = ref<{ time: number; index: number } | null>(null)

const chart = computed(() => {
  const allTimes = new Set<number>()
  for (const s of props.series) for (const p of s.points) allTimes.add(p.time)
  const times = [...allTimes].sort((a, b) => a - b)
  if (times.length === 0 || props.series.length === 0) return null

  // Sort series by total volume, keep top N, fold rest into "other"
  const sorted = [...props.series].sort((a, b) => total(b.points) - total(a.points))
  const top = sorted.slice(0, props.topN)
  const rest = sorted.slice(props.topN)
  const folded = rest.length > 0
    ? [...top, foldOthers(rest, times)]
    : top

  // Build aligned value matrix [seriesIdx][timeIdx]
  const valueByTime = folded.map((s) => {
    const map = new Map(s.points.map((p) => [p.time, p.value]))
    return times.map((t) => map.get(t) ?? 0)
  })

  // Stacked cumulative
  const stacked = valueByTime.map((row) => new Array(row.length).fill(0))
  for (let ti = 0; ti < times.length; ti++) {
    let acc = 0
    for (let si = 0; si < folded.length; si++) {
      acc += valueByTime[si][ti]
      stacked[si][ti] = acc
    }
  }

  const maxY = Math.max(1, ...stacked[stacked.length - 1])
  const minT = times[0]
  const maxT = times[times.length - 1] || minT + 1
  const xSpan = Math.max(1, maxT - minT)

  // Build SVG paths for each layer (top edge = stacked[si], bottom edge = stacked[si-1] or 0)
  function xAt(t: number): number {
    return ((t - minT) / xSpan) * 100
  }
  function yAt(v: number): number {
    return 100 - (v / maxY) * 100
  }

  const layers = folded.map((s, si) => {
    const topEdge = times.map((t, ti) => `${xAt(t).toFixed(2)},${yAt(stacked[si][ti]).toFixed(2)}`)
    const bottomEdge = si === 0
      ? [`${xAt(maxT).toFixed(2)},100`, `${xAt(minT).toFixed(2)},100`]
      : times.slice().reverse().map((t, ri) => {
          const ti = times.length - 1 - ri
          return `${xAt(t).toFixed(2)},${yAt(stacked[si - 1][ti]).toFixed(2)}`
        })
    const d = `M ${topEdge.join(' L ')} L ${bottomEdge.join(' L ')} Z`
    return { name: s.name, d, color: PALETTE[si % PALETTE.length], values: valueByTime[si] }
  })

  return { times, layers, maxY, minT, maxT }
})

const totalAt = computed(() => {
  if (!chart.value || !hovered.value) return null
  const { index } = hovered.value
  let sum = 0
  for (const l of chart.value.layers) sum += l.values[index] ?? 0
  return sum
})

function onMove(e: MouseEvent) {
  if (!chart.value) return
  const target = e.currentTarget as SVGSVGElement
  const rect = target.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width)
  const { times } = chart.value
  const idx = Math.max(0, Math.min(times.length - 1, Math.round(pct * (times.length - 1))))
  hovered.value = { time: times[idx], index: idx }
}

function onLeave() {
  hovered.value = null
}

function total(points: Point[]): number {
  return points.reduce((a, p) => a + p.value, 0)
}

function foldOthers(series: Series[], times: number[]): Series {
  const sumByTime = new Map<number, number>()
  for (const s of series) {
    for (const p of s.points) sumByTime.set(p.time, (sumByTime.get(p.time) ?? 0) + p.value)
  }
  return { name: `+${series.length} autres`, points: times.map((t) => ({ time: t, value: sumByTime.get(t) ?? 0 })) }
}

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-neutral-300">Volume par app</h3>
      <div v-if="hovered && chart" class="text-xs text-neutral-400 font-mono">
        {{ formatTime(hovered.time) }} · {{ totalAt?.toFixed(0) }} lignes/min
      </div>
    </div>

    <div v-if="!chart" class="flex items-center justify-center text-neutral-500 text-xs" :style="{ height: height + 'px' }">
      Aucune donnée
    </div>

    <div v-else class="flex gap-3">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        class="flex-1 cursor-crosshair"
        :style="{ height: height + 'px' }"
        @mousemove="onMove"
        @mouseleave="onLeave"
      >
        <path
          v-for="layer in chart.layers"
          :key="layer.name"
          :d="layer.d"
          :fill="layer.color"
          :fill-opacity="0.7"
          :stroke="layer.color"
          stroke-width="0.4"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="hovered"
          :x1="((hovered.time - chart.minT) / (chart.maxT - chart.minT)) * 100"
          :x2="((hovered.time - chart.minT) / (chart.maxT - chart.minT)) * 100"
          y1="0" y2="100"
          stroke="white" stroke-opacity="0.4" stroke-width="0.3"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <ul class="flex flex-col gap-1 text-xs w-44 overflow-y-auto" :style="{ maxHeight: height + 'px' }">
        <li
          v-for="layer in chart.layers"
          :key="layer.name"
          class="flex items-center gap-2 truncate"
        >
          <span class="size-2 rounded-sm shrink-0" :style="{ backgroundColor: layer.color }" />
          <span class="truncate text-neutral-300">{{ layer.name }}</span>
          <span v-if="hovered" class="ml-auto font-mono text-neutral-400 tabular-nums">
            {{ (layer.values[hovered.index] ?? 0).toFixed(0) }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
