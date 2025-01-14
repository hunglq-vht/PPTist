import { defineStore } from 'pinia'
import type { IndexableTypeArray } from 'dexie'
import { db, type Snapshot } from '@/utils/database'

import { useSlidesStore } from './slides'
import { useMainStore } from './main'

export interface ScreenState {
  snapshotCursor: number
  snapshotLength: number
}

export const useSnapshotStore = defineStore('snapshot', {
  state: (): ScreenState => ({
    snapshotCursor: -1, // history snapshot pointer
    snapshotLength: 0, // history snapshot length
  }),

  getters: {
    canUndo(state) {
      return state.snapshotCursor > 0
    },
    canRedo(state) {
      return state.snapshotCursor < state.snapshotLength - 1
    },
  },

  actions: {
    setSnapshotCursor(cursor: number) {
      this.snapshotCursor = cursor
    },
    setSnapshotLength(length: number) {
      this.snapshotLength = length
    },

    async initSnapshotDatabase() {
      const slidesStore = useSlidesStore()
  
      const newFirstSnapshot = {
        index: slidesStore.slideIndex,
        slides: slidesStore.slides,
      }
      await db.snapshots.add(newFirstSnapshot)
      this.setSnapshotCursor(0)
      this.setSnapshotLength(1)
    },
  
    /**
     * Adds a new snapshot to the IndexedDB and manages the snapshot history.
     * 
     * This function performs the following steps:
     * 1. Retrieves all snapshot IDs from the IndexedDB.
     * 2. Determines which snapshots need to be deleted if the current snapshot pointer is not at the last position.
     * 3. Creates and adds a new snapshot to the IndexedDB.
     * 4. Calculates the new snapshot length and adjusts the snapshot pointer.
     * 5. Deletes excess snapshots if the snapshot count exceeds the defined limit.
     * 6. Ensures that the page focus remains unchanged after undo operations by updating the index of the second-to-last snapshot.
     * 7. Deletes the snapshots that are no longer needed.
     * 8. Updates the snapshot cursor and length in the store.
     * 
     * @async
     * @returns {Promise<void>} A promise that resolves when the snapshot has been added and the history has been managed.
     */
    async addSnapshot() {
      const slidesStore = useSlidesStore()

      // 获取当前indexeddb中全部快照的ID
      const allKeys = await db.snapshots.orderBy('id').keys()
  
      let needDeleteKeys: IndexableTypeArray = []
  
      // Record the IDs of snapshots that need to be deleted
      // If the current snapshot pointer is not at the last position, then when adding a new snapshot, 
      // all snapshots after the current pointer position should be deleted. 
      // The actual scenario is: after the user undoes multiple times and then performs an operation (adds a snapshot), 
      // the previously undone snapshots should all be deleted.
      if (this.snapshotCursor >= 0 && this.snapshotCursor < allKeys.length - 1) {
        needDeleteKeys = allKeys.slice(this.snapshotCursor + 1)
      }
  
      // Add a new snapshot
      const snapshot = {
        index: slidesStore.slideIndex,
        slides: slidesStore.slides,
      }
      await db.snapshots.add(snapshot)
      
      // Calculate the current snapshot length to set the snapshot pointer position (at this point, the pointer should be at the last position, i.e., snapshot length - 1)
      let snapshotLength = allKeys.length - needDeleteKeys.length + 1
      
      // When the number of snapshots exceeds the length limit, the excess snapshots at the beginning should be deleted
      const snapshotLengthLimit = 20
      if (snapshotLength > snapshotLengthLimit) {
        needDeleteKeys.push(allKeys[0])
        snapshotLength--
      }
  
      // When the number of snapshots is greater than 1, ensure that the page focus remains unchanged after undo operations: 
      // update the index of the second-to-last snapshot to the current page index
      // https://github.com/pipipi-pikachu/PPTist/issues/27
      if (snapshotLength >= 2) {
        db.snapshots.update(allKeys[snapshotLength - 2] as number, { index: slidesStore.slideIndex })
      }
  
      await db.snapshots.bulkDelete(needDeleteKeys)
  
      this.setSnapshotCursor(snapshotLength - 1)
      this.setSnapshotLength(snapshotLength)
    },
  
    async unDo() {
      if (this.snapshotCursor <= 0) return

      const slidesStore = useSlidesStore()
      const mainStore = useMainStore()
  
      const snapshotCursor = this.snapshotCursor - 1
      const snapshots: Snapshot[] = await db.snapshots.orderBy('id').toArray()
      const snapshot = snapshots[snapshotCursor]
      const { index, slides } = snapshot
  
      const slideIndex = index > slides.length - 1 ? slides.length - 1 : index
  
      slidesStore.setSlides(slides)
      slidesStore.updateSlideIndex(slideIndex)
      this.setSnapshotCursor(snapshotCursor)
      mainStore.setActiveElementIdList([])
    },
  
    async reDo() {
      if (this.snapshotCursor >= this.snapshotLength - 1) return

      const slidesStore = useSlidesStore()
      const mainStore = useMainStore()
  
      const snapshotCursor = this.snapshotCursor + 1
      const snapshots: Snapshot[] = await db.snapshots.orderBy('id').toArray()
      const snapshot = snapshots[snapshotCursor]
      const { index, slides } = snapshot
  
      const slideIndex = index > slides.length - 1 ? slides.length - 1 : index
  
      slidesStore.setSlides(slides)
      slidesStore.updateSlideIndex(slideIndex)
      this.setSnapshotCursor(snapshotCursor)
      mainStore.setActiveElementIdList([])
    },
  },
})