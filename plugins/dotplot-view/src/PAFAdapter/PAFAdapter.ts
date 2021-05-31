import {
  BaseFeatureDataAdapter,
  BaseOptions,
} from '@jbrowse/core/data_adapters/BaseAdapter'
import {
  FileLocation,
  NoAssemblyRegion,
  Region,
} from '@jbrowse/core/util/types'
import { doesIntersect2 } from '@jbrowse/core/util/range'
import { GenericFilehandle } from 'generic-filehandle'
import { openLocation } from '@jbrowse/core/util/io'
import { ObservableCreate } from '@jbrowse/core/util/rxjs'
import SimpleFeature, { Feature } from '@jbrowse/core/util/simpleFeature'
import AbortablePromiseCache from 'abortable-promise-cache'
import QuickLRU from '@jbrowse/core/util/QuickLRU'
import { Instance } from 'mobx-state-tree'
import { readConfObject } from '@jbrowse/core/configuration'
import MyConfigSchema from './configSchema'

interface PafRecord {
  records: NoAssemblyRegion[]
  extra: {
    blockLen: number
    mappingQual: number
    numMatches: number
    strand: string
    meanScore?: number
  }
}

function zip(a: number[], b: number[]): [number, number][] {
  return a.map(function (e, i) {
    return [e, b[i]]
  })
}
//https://gist.github.com/stekhn/a12ed417e91f90ecec14bcfa4c2ae16a
function weightedMean(tuples: [number, number][]) {
  const [valueSum, weightSum] = tuples.reduce(
    ([valueSum, weightSum], [value, weight]) => [
      valueSum + value * weight,
      weightSum + weight,
    ],
    [0, 0],
  )
  return valueSum / weightSum
}

export default class PAFAdapter extends BaseFeatureDataAdapter {
  private cache = new AbortablePromiseCache({
    cache: new QuickLRU({ maxSize: 1 }),
    fill: (data: BaseOptions, signal?: AbortSignal) => {
      return this.setup({ ...data, signal })
    },
  })

  private assemblyNames: string[]

  private pafLocation: GenericFilehandle

  public static capabilities = ['getFeatures', 'getRefNames']

  public constructor(config: Instance<typeof MyConfigSchema>) {
    super(config)
    const pafLocation = readConfObject(config, 'pafLocation') as FileLocation
    const assemblyNames = readConfObject(config, 'assemblyNames') as string[]
    this.pafLocation = openLocation(pafLocation)
    this.assemblyNames = assemblyNames
  }

  async setup(opts?: BaseOptions): Promise<PafRecord[]> {
    const text = (await this.pafLocation.readFile({
      encoding: 'utf8',
      ...opts,
    })) as string
    const ret = text
      .split('\n')
      .filter(f => !!f)
      .map(line => {
        const [
          chr1,
          queryRefSeqLen,
          start1,
          end1,
          strand,
          chr2,
          targetRefSeqLen,
          start2,
          end2,
          numMatches,
          blockLen,
          mappingQual,
          ...fields
        ] = line.split('\t')

        const rest = Object.fromEntries(
          fields.map(field => {
            const r = field.indexOf(':')
            const fieldName = field.slice(0, r)
            const fieldValue = field.slice(r + 3)
            return [fieldName, fieldValue]
          }),
        )

        return {
          records: [
            { refName: chr1, start: +start1, end: +end1 },
            { refName: chr2, start: +start2, end: +end2 },
          ],
          extra: {
            numMatches: +numMatches,
            blockLen: +blockLen,
            strand,
            mappingQual: +mappingQual,
            ...rest,
          },
        } as PafRecord
      })

    // calculate the "weighted mean" (e.g. longer alignments factor in more
    // heavily) of all the fragments of a query vs the reference that it mapped
    // to
    //
    // this uses a combined key query+'-'+ref to iteratively map all the
    // alignments that match a particular ref from a particular query (so 1d
    // array of what could be a 2d map)
    //
    // the result is a single number that says e.g. chr5 from human mapped to
    // chr5 on mouse with 0.8 quality, and that0.8 is then attached to all the
    // pieces of chr5 on human that mapped to chr5 on mouse. if chr5 on human
    // also more weakly mapped to chr6 on mouse, then it would have another
    // value e.g. 0.6. this can show strong and weak levels of synteny,
    // especially in polyploidy situations
    const scoreMap: { [key: string]: { quals: number[]; len: number[] } } = {}
    for (let i = 0; i < ret.length; i++) {
      const entry = ret[i]
      const query = entry.records[0].refName
      const target = entry.records[1].refName
      const key = query + '-' + target
      if (!scoreMap[key]) {
        scoreMap[key] = { quals: [], len: [] }
      }
      scoreMap[key].quals.push(entry.extra.mappingQual)
      scoreMap[key].len.push(entry.extra.blockLen)
    }

    const meanScoreMap = Object.fromEntries(
      Object.entries(scoreMap).map(([key, val]) => {
        const vals = zip(val.quals, val.len)
        return [key, weightedMean(vals)]
      }),
    )
    for (let i = 0; i < ret.length; i++) {
      const entry = ret[i]
      const query = entry.records[0].refName
      const target = entry.records[1].refName
      const key = query + '-' + target
      entry.extra.meanScore = meanScoreMap[key]
    }

    let min = 10000
    let max = 0
    for (let i = 0; i < ret.length; i++) {
      const entry = ret[i]
      min = Math.min(entry.extra.meanScore, min)
      max = Math.max(entry.extra.meanScore, max)
    }
    console.log({ min, max })
    for (let i = 0; i < ret.length; i++) {
      const entry = ret[i]
      const b = entry.extra.meanScore
      entry.extra.meanScore = (entry.extra.meanScore - min) / (max - min)
      // console.log(b, entry.extra.meanScore)
    }

    return ret
  }

  async hasDataForRefName() {
    // determining this properly is basically a call to getFeatures
    // so is not really that important, and has to be true or else
    // getFeatures is never called (BaseAdapter filters it out)
    return true
  }

  async getRefNames() {
    // we cannot determine this accurately
    return []
  }

  getFeatures(region: Region, opts: BaseOptions = {}) {
    return ObservableCreate<Feature>(async observer => {
      const pafRecords = await this.cache.get('initialize', opts, opts.signal)

      // The index of the assembly name in the region list corresponds to
      // the adapter in the subadapters list
      const index = this.assemblyNames.indexOf(region.assemblyName)
      if (index !== -1) {
        for (let i = 0; i < pafRecords.length; i++) {
          const { extra, records } = pafRecords[i]
          const { start, end, refName } = records[index]
          if (records[index].refName === region.refName) {
            if (doesIntersect2(region.start, region.end, start, end)) {
              observer.next(
                new SimpleFeature({
                  uniqueId: `row_${i}`,
                  start,
                  end,
                  refName,
                  syntenyId: i,
                  mate: {
                    start: records[+!index].start,
                    end: records[+!index].end,
                    refName: records[+!index].refName,
                  },
                  ...extra,
                }),
              )
            }
          }
        }
      }

      observer.complete()
    })
  }

  freeResources(/* { region } */): void {}
}
