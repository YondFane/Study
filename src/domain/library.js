import {
  categories as sourceCategories,
  datasets as sourceDatasets,
  loadDataset,
  loadSearchIndex,
} from '../../data/excel/index.js'

const CATEGORY_NAVIGATION_ORDER = [
  'high-school-entrance',
  'college-entrance',
  'cet4',
  'cet6',
  'tem8',
  'ielts',
  'toefl',
  'new-concept-english',
]

const DATASET_TYPE_ORDER = { vocabulary: 0, phrase: 1, course: 2 }
const datasetById = new Map(sourceDatasets.map((dataset) => [dataset.id, dataset]))
const enrichedDatasetPromises = new Map()

function enrichDataset(dataset, category) {
  if (!enrichedDatasetPromises.has(dataset.id)) {
    // Enrichment used to run on every category switch. Cache the immutable result so
    // returning to a large vocabulary set does not recreate thousands of objects.
    const promise = loadDataset(dataset.id)
      .then((entries) => entries.map((entry) => ({
        ...entry,
        __categoryId: category.id,
        __categoryLabel: category.label,
        __datasetId: dataset.id,
        __datasetLabel: dataset.label,
        __type: dataset.type,
      })))
      .catch((error) => {
        enrichedDatasetPromises.delete(dataset.id)
        throw error
      })
    enrichedDatasetPromises.set(dataset.id, promise)
  }

  return enrichedDatasetPromises.get(dataset.id)
}

export const navigationGroups = [...sourceCategories]
  .sort((left, right) =>
    CATEGORY_NAVIGATION_ORDER.indexOf(left.id) - CATEGORY_NAVIGATION_ORDER.indexOf(right.id),
  )
  .map((category) => ({
    ...category,
    options: category.datasets
      .map((id) => datasetById.get(id))
      .filter(Boolean)
      .sort((left, right) =>
        (DATASET_TYPE_ORDER[left.type] ?? 9) - (DATASET_TYPE_ORDER[right.type] ?? 9),
      )
      .map((dataset) => ({
        ...dataset,
        description: `${category.label} · ${dataset.label}，共 ${dataset.count.toLocaleString()} 条`,
        load: () => enrichDataset(dataset, category),
      })),
  }))

export const libraryCategories = navigationGroups.flatMap((group) => group.options)
export const datasetDefinitions = sourceDatasets

export function loadLibrarySearchIndex() {
  return loadSearchIndex()
}

export async function loadLibraryDatasetEntry(datasetId, rowIndex) {
  const category = libraryCategories.find((item) => item.id === datasetId)
  if (!category) throw new Error(`Unknown dataset: ${datasetId}`)

  const entries = await category.load()
  return entries[rowIndex]
}

