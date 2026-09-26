# Muscle groups

Volume is counted in 17 muscle groups. They are the ids in
`src/library/muscles.csv`, and every exercise in `src/library/exercises.csv`
credits one or more of them directly, by role (`primary`, `secondary`, `aux`).

The groups are flat and do not overlap: each muscle belongs to exactly one group,
so per-group totals can be summed. There is no finer level underneath and no
rollup above. A group is fine enough to show an imbalance and coarse enough that
an exercise can be tagged without guessing at individual heads.

## Rules for crediting exercises

- **List each group once, at its highest role.** A bench press is `pecs` primary;
  the incline-biased clavicular head does not add a second `pecs` entry.
- **The whole adductor magnus is `adductors`.** Its posterior part extends the
  hip alongside the hamstrings, but crediting it there would make a squat read as
  hamstring work when what it loads is the adductor. Hinges credit `adductors` as
  a lesser role instead.
- **Squats do not credit `hip_flexors`.** Rectus femoris is barely loaded by a
  squat; leg extensions and leg raises are what train it.
- **Credit serratus through `front_delts`**, which is where upward scapular
  rotation lives. That is why planks and the ab wheel list it as `aux`.

## Changing the vocabulary

Exercises reference these ids permanently, and lifters' own exercises in their
log repos reference them too. Renaming or removing a group is a change to the
app, not an edit to a data file. Rewording a `name` is safe. Adding a group is
additive, but it only counts once exercises credit it. `tests/library.test.ts`
fails if any group has no exercise crediting it.

## The groups

Each group lists its id, the muscles it covers, the joint actions it covers, and
which exercises load it.

### 1. Hamstrings (`hamstrings`)

Muscles:

- Biceps femoris (long and short heads)
- Semitendinosus
- Semimembranosus

Joint actions: hip extension, knee flexion.

Exercises: RDLs, good mornings, deadlifts and leg curls. The adductor magnus helps extend the hip in all of these but belongs to adductors, not here. Hinges alone miss the short head of the biceps femoris, which only flexes the knee, so leg curls are still needed to cover the whole group.

### 2. Glutes (`glutes`)

Muscles:

- Glute max
- Glute med
- Glute min
- TFL
- Deep hip rotators

Joint actions: hip extension, hip abduction, hip external and internal rotation.

Exercises: squats, hip thrusts and deadlifts load glute max. Abduction machines, lateral band walks and single-leg work load glute med, glute min and TFL.

### 3. Hip flexors (`hip_flexors`)

Muscles:

- Iliopsoas
- Sartorius
- Rectus femoris

Joint actions: hip flexion, plus knee extension (rectus femoris) and knee flexion (sartorius).

Exercises: leg raises, straight leg raises and leg extensions. Rectus femoris sits here instead of in quads on purpose. Squats barely load it, and leg extensions are the main way to train it. Grouping it with the hip flexors lets leg extensions and hip flexion work show up as their own volume. Straight leg raises also load sartorius hard.

### 4. Quads (`quads`)

Muscles:

- Vastus lateralis
- Vastus medialis
- Vastus intermedius

Joint actions: knee extension.

Exercises: squats, leg presses, lunges, split squats and leg extensions.

### 5. Adductors (`adductors`)

Muscles:

- Adductor magnus (anterior and posterior parts)
- Adductor longus
- Adductor brevis
- Pectineus
- Gracilis

Joint actions: hip adduction, plus hip extension (posterior adductor magnus).

Exercises: adductor machine, Copenhagen planks, squats and sumo deadlifts. Conventional deadlifts and other hinges load it through hip extension, as a lesser role.

### 6. Calves (`calves`)

Muscles:

- Gastrocnemius
- Soleus

Joint actions: ankle plantarflexion.

Exercises: standing calf raises bias gastrocnemius. Seated calf raises bias soleus.

### 7. Tibialis (`tibialis`)

Muscles:

- Tibialis anterior

Joint actions: ankle dorsiflexion.

Exercises: tib raises. None of the main lifts load it.

### 8. Abs (`abs`)

Muscles:

- Rectus abdominis
- External obliques
- Internal obliques

Joint actions: spinal flexion, spinal lateral flexion, spinal rotation.

Exercises: crunches, leg raises, ab wheel, Pallof presses and side bends.

### 9. Lower back (`lower_back`)

Muscles:

- Erector spinae
- Multifidus
- Quadratus lumborum

Joint actions: spinal extension, spinal lateral flexion.

Exercises: deadlifts, good mornings and back extensions load it directly. Squats load it isometrically.

### 10. Lats (`lats`)

Muscles:

- Latissimus dorsi
- Teres major
- Subscapularis

Joint actions: shoulder extension, shoulder adduction, shoulder internal rotation.

Exercises: pull-ups, pulldowns, pullovers and rows with the elbows tucked. Lats and teres major work together in all of these. Subscapularis rarely gets direct work and is here because it shares internal rotation with the lats.

### 11. Pecs (`pecs`)

Muscles:

- Pec major (clavicular and sternal heads)
- Pec minor

Joint actions: shoulder horizontal adduction, shoulder flexion, scapular protraction and depression.

Exercises: bench press variations, flyes and dips. Both pec major heads are kept together because every bench variation loads both. Incline work shifts some emphasis to the clavicular head but not enough to justify a separate group. Pec minor has no exercise of its own and gets loaded in dips and pressing.

### 12. Front delts (`front_delts`)

Muscles:

- Anterior delt
- Lateral delt
- Supraspinatus
- Serratus anterior

Joint actions: shoulder flexion, shoulder abduction, scapular upward rotation.

Exercises: overhead presses, lateral raises and front raises. Overhead presses load both delt heads plus serratus. Lateral raises load the lateral delt and supraspinatus, with the anterior delt helping. Because both main exercises hit both heads, they share one group, named for the front delt because that is the head pressing loads. Bench press loads the anterior delt as a secondary.

### 13. Rear delts (`rear_delts`)

Muscles:

- Posterior delt
- Infraspinatus
- Teres minor

Joint actions: shoulder horizontal abduction, shoulder external rotation, shoulder extension.

Exercises: face pulls, reverse flyes and external rotation work. Rows load it partly. It is the counterpart of front delts. It is kept separate from upper back because it trains through shoulder movement, not shoulder blade movement.

### 14. Upper back (`upper_back`)

Muscles:

- Upper, middle and lower trapezius
- Rhomboids
- Levator scapulae

Joint actions: scapular retraction, elevation, depression and upward rotation.

Exercises: rows, shrugs, Y-raises and rack pulls. Deadlifts load it isometrically. Upper traps are merged in because shrugs are uncommon in powerlifting programming.

### 15. Biceps (`biceps`)

Muscles:

- Biceps brachii (long and short heads)
- Brachialis
- Brachioradialis

Joint actions: elbow flexion, forearm supination.

Exercises: curls of any grip. Hammer curls bias brachialis and brachioradialis. Rows and pull-ups load this group as a secondary.

### 16. Triceps (`triceps`)

Muscles:

- Triceps (long, lateral and medial heads)

Joint actions: elbow extension.

Exercises: bench press, close-grip bench, dips, pushdowns and overhead extensions. Overhead extensions bias the long head.

### 17. Forearms (`forearms`)

Muscles:

- Forearm flexors
- Forearm extensors

Joint actions: wrist and finger flexion, wrist extension, forearm pronation.

Exercises: grip work, farmer's carries, wrist curls and deadlift holds. Deadlifts and rows load the flexors through grip.
